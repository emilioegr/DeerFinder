import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import xml2js from 'xml2js';
import fs from 'fs';
import { sessionMiddleware, requireAdmin, adminRouter } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;
const MONGODB_URI = process.env.MONGODB_URI;

// --- Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `gpx-${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/gpx+xml' || 
        file.originalname.toLowerCase().endsWith('.gpx') ||
        file.mimetype === 'text/xml' ||
        file.mimetype === 'application/xml') {
      cb(null, true);
    } else {
      cb(new Error('Only GPX files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// --- CORS
app.use(cors());

// --- Security & logging
// helmet's default CSP only allows same-origin/data: images, which silently
// blocks the map: OSM tiles, the deer marker icon, and the Leaflet marker
// shadow are all loaded from external CDNs. Never surfaced before now since
// in dev the page is served by Vite (not behind Express/helmet at all) -
// only shows up once the app is actually served by this server, i.e. now.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': [
        "'self'",
        'data:',
        'https://*.tile.openstreetmap.org',
        'https://cdn-icons-png.flaticon.com',
        'https://cdnjs.cloudflare.com',
      ],
    },
  },
}));
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(sessionMiddleware);

// General throttle on the whole public API surface (POST /api/sightings in
// particular has no other spam protection). Login has its own tighter limit
// in auth.js on top of this one.
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// --- Mongoose
await mongoose.connect(MONGODB_URI, { dbName: 'phoenix_deer' });

// --- Schema & Model
const sightingSchema = new mongoose.Schema({
  lat: Number,
  lng: Number,
  description: String,
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number] }, // [lng, lat]
  },
}, {
  timestamps: true
});

sightingSchema.index({ location: '2dsphere' });

const Sighting = mongoose.model('Sighting', sightingSchema);

// Backfill `location` on any pre-existing docs saved before the geo index
// was added, so dedup queries below actually find them via $near.
await Sighting.updateMany(
  { location: { $exists: false }, lat: { $type: 'number' }, lng: { $type: 'number' } },
  [{ $set: { location: { type: 'Point', coordinates: ['$lng', '$lat'] } } }]
);

// A duplicate is anything within DEDUP_RADIUS_METERS of a candidate point
// with the exact same createdAt timestamp. 15m comfortably covers the old
// +/-0.0001-degree lat/lng box this replaces (worst-case corner ~13m).
const DEDUP_RADIUS_METERS = 15;

// Manual submissions (map click / "found a deer here") don't carry a
// caller-set timestamp like GPX waypoints do, so exact-createdAt matching
// can't catch accidental double-submits (double click, double tap, a
// retried request). Treat anything at the same spot within this window
// as the same submission instead.
const MANUAL_DUPLICATE_WINDOW_MS = 10 * 1000;

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// --- Shared dedup+insert logic
async function saveSightingsFromFile(filePath) {
  const sightings = await parseGPXFile(filePath);
  if (sightings.length === 0) return { inserted: 0, updated: 0, skipped: 0, total: 0 };

  const newSightings = [];
  const updatedSightings = [];

  for (const sighting of sightings) {
    const sightingTime = new Date(sighting.createdAt).getTime();

    // Check against sightings already queued from this same file before
    // hitting the DB, so two near-duplicate waypoints in one GPX don't
    // both get inserted (the DB-side $near check below only sees docs
    // that were already committed on a *previous* import).
    const batchMatch = newSightings.find(existing =>
      existing.createdAt.getTime() === sightingTime &&
      distanceMeters(existing.lat, existing.lng, sighting.lat, sighting.lng) < DEDUP_RADIUS_METERS
    );
    if (batchMatch) continue;

    const existingMatch = await Sighting.findOne({
      createdAt: sighting.createdAt,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [sighting.lng, sighting.lat] },
          $maxDistance: DEDUP_RADIUS_METERS,
        },
      },
    });

    if (existingMatch) {
      updatedSightings.push({ _id: existingMatch._id, updateData: { updatedAt: new Date() } });
    } else {
      newSightings.push({
        lat: sighting.lat,
        lng: sighting.lng,
        description: sighting.description,
        createdAt: sighting.createdAt,
        location: { type: 'Point', coordinates: [sighting.lng, sighting.lat] },
      });
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;

  if (newSightings.length > 0) {
    const results = await Sighting.insertMany(newSightings, { timestamps: false });
    insertedCount = results.length;
  }

  for (const update of updatedSightings) {
    await Sighting.findByIdAndUpdate(update._id, update.updateData, { new: true });
    updatedCount++;
  }

  return {
    inserted: insertedCount,
    updated: updatedCount,
    skipped: sightings.length - insertedCount - updatedCount,
    total: sightings.length,
  };
}

// --- GPX Parsing Function
async function parseGPXFile(filePath) {
  try {
    const gpxData = fs.readFileSync(filePath, 'utf8');
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(gpxData);
    
    const waypoints = [];
    
    // Helper function to check if name contains "deer" in various languages
    const containsDeer = (name) => {
      if (!name) return false;
      const lowerName = name.toLowerCase();
      
      // Deer in multiple languages
      const deerWords = [
        'deer', 'stag', 'doe', 'buck', 'fawn', // English
        'cervo', 'ciervo', 'cerf', 'hirsch',"venado",   // Italian, Spanish, French, German
        'jeleň', 'олень', '鹿', 'hjort',       // Slovak, Russian, Chinese, Nordic
        'fia', 'szarvas', 'hert', 'veado'      // Irish, Hungarian, Dutch, Portuguese
      ];
      
      return deerWords.some(word => lowerName.includes(word));
    };
    
    // Helper function to get proper description
    const getDescription = (name, desc) => {
      // Use name as primary description
      let description = name || desc || 'Waypoint';
      
      // If name contains deer in any language, use deer emoji version
      if (containsDeer(description)) {
        description = '🦌 Deer spotted here!';
      }
      
      return description;
    };
    
    // Parse waypoints (most common for manual points)
    if (result.gpx && result.gpx.wpt) {
      result.gpx.wpt.forEach(wpt => {
        const lat = parseFloat(wpt.$.lat);
        const lng = parseFloat(wpt.$.lon);
        const name = wpt.name ? wpt.name[0] : null;
        const desc = wpt.desc ? wpt.desc[0] : null;
        const time = wpt.time ? new Date(wpt.time[0]) : new Date();
        
        waypoints.push({
          lat,
          lng,
          description: getDescription(name, desc),
          createdAt: time
        });
      });
    }
    
    // Parse track points if no waypoints found
    if (waypoints.length === 0 && result.gpx && result.gpx.trk) {
      result.gpx.trk.forEach(track => {
        if (track.trkseg) {
          track.trkseg.forEach(segment => {
            if (segment.trkpt) {
              segment.trkpt.forEach(point => {
                const lat = parseFloat(point.$.lat);
                const lng = parseFloat(point.$.lon);
                const name = point.name ? point.name[0] : null;
                const desc = point.desc ? point.desc[0] : null;
                const time = point.time ? new Date(point.time[0]) : new Date();
                
                waypoints.push({
                  lat,
                  lng,
                  description: getDescription(name, desc) || '🦌 Deer spotted here!',
                  createdAt: time
                });
              });
            }
          });
        }
      });
    }
    
    // Parse route points if no waypoints or tracks found
    if (waypoints.length === 0 && result.gpx && result.gpx.rte) {
      result.gpx.rte.forEach(route => {
        if (route.rtept) {
          route.rtept.forEach(point => {
            const lat = parseFloat(point.$.lat);
            const lng = parseFloat(point.$.lon);
            const name = point.name ? point.name[0] : null;
            const desc = point.desc ? point.desc[0] : null;
            
            waypoints.push({
              lat,
              lng,
              description: getDescription(name, desc) || 'Waypoint',
              createdAt: new Date()
            });
          });
        }
      });
    }
    
    return waypoints;
  } catch (error) {
    console.error('Error parsing GPX file:', error);
    throw error;
  }
}

// --- Routes
app.use('/api/admin', adminRouter);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/sightings', async (_req, res) => {
  try {
    const docs = await Sighting.find().sort({ createdAt: -1 }).limit(500);
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sightings' });
  }
});

app.post('/api/sightings', async (req, res) => {
  try {
    const { lat, lng, description } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }

    const recentDuplicate = await Sighting.findOne({
      createdAt: { $gte: new Date(Date.now() - MANUAL_DUPLICATE_WINDOW_MS) },
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: DEDUP_RADIUS_METERS,
        },
      },
    });
    if (recentDuplicate) {
      return res.status(200).json(recentDuplicate);
    }

    const doc = await Sighting.create({
      lat, lng, description,
      location: { type: 'Point', coordinates: [lng, lat] },
    });
    res.status(201).json(doc);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create sighting' });
  }
});

app.patch('/api/sightings/:id', requireAdmin, async (req, res) => {
  try {
    const { description } = req.body;
    if (typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'description is required' });
    }
    if (description.length > 300) {
      return res.status(400).json({ error: 'description must be 300 characters or fewer' });
    }

    const doc = await Sighting.findByIdAndUpdate(
      req.params.id,
      { description: description.trim() },
      { new: true }
    );
    if (!doc) return res.status(404).json({ error: 'Sighting not found' });
    res.json(doc);
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Sighting not found' });
    res.status(500).json({ error: 'Failed to update sighting' });
  }
});

app.delete('/api/sightings/:id', requireAdmin, async (req, res) => {
  try {
    const doc = await Sighting.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Sighting not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.name === 'CastError') return res.status(404).json({ error: 'Sighting not found' });
    res.status(500).json({ error: 'Failed to delete sighting' });
  }
});

// --- GPX Upload and Import Route
app.post('/api/import-gpx', requireAdmin, upload.single('gpxFile'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No GPX file uploaded' });

    const result = await saveSightingsFromFile(req.file.path);
    fs.unlinkSync(req.file.path);

    if (result.total === 0) return res.status(400).json({ error: 'No waypoints, tracks, or routes found in GPX file' });

    res.json({ success: true, message: 'GPX import completed', ...result });
  } catch (error) {
    console.error('GPX import error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to import GPX file', details: error.message });
  }
});

// --- Import from local Garmin folder
app.post('/api/import-garmin', requireAdmin, async (req, res) => {
  try {
    const garminDir = path.join(__dirname, '..', 'Garmin', 'GPX');
    const files = fs.readdirSync(garminDir).filter(f => f.toLowerCase().endsWith('.gpx'));

    if (files.length === 0) return res.status(404).json({ error: 'No GPX files found in Garmin folder' });

    let totalInserted = 0, totalUpdated = 0, totalSkipped = 0, totalPoints = 0;

    for (const file of files) {
      const result = await saveSightingsFromFile(path.join(garminDir, file));
      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
      totalPoints += result.total;
    }

    res.json({
      success: true,
      filesProcessed: files.length,
      total: totalPoints,
      inserted: totalInserted,
      updated: totalUpdated,
      skipped: totalSkipped,
    });
  } catch (error) {
    console.error('Garmin import error:', error);
    res.status(500).json({ error: 'Failed to import Garmin data', details: error.message });
  }
});

// --- Get import stats
app.get('/api/import-stats', requireAdmin, async (_req, res) => {
  try {
    const totalSightings = await Sighting.countDocuments();
    const todaySightings = await Sighting.countDocuments({
      createdAt: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0)),
        $lt: new Date(new Date().setHours(23, 59, 59, 999))
      }
    });
    const recentSightings = await Sighting.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('lat lng description createdAt');

    res.json({
      totalSightings,
      todaySightings,
      recentSightings
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// --- SPA fallback: serve index.html for any non-API route (e.g. /admin),
// so a direct navigation or page refresh there doesn't 404 against the
// static file server. No-op in dev - Vite's dev server does this itself
// (the frontend runs on :5173, and only /api/* is proxied here to :5050).
// Only matters once client/ is actually built into public/, which isn't
// wired up yet - degrade gracefully rather than throw ENOENT until then.
app.get(/^(?!\/api).*/, (_req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Frontend build not found - run the client dev server on :5173 instead.');
  }
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));