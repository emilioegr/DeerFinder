# Phoenix Park Deer Tracker – MVP

A lightweight, crowdsourced web app to pin and confirm deer sightings in Dublin’s Phoenix Park.

---

## 1) Technical Architecture Diagram

```text
+--------------------+           HTTPS            +------------------+
|  Browser (Client)  | <------------------------> |  Express API     |
|  • Leaflet map     |   (JSON REST + Static)     |  (Node.js)       |
|  • Fetch API       |                           /|                  |
|  • Pin + confirm   |      Tile requests       / |  Routes:         |
+----------+---------+      (OSM/Map tiles)    /  |  • GET /api/sightings
           |                                 /   |  • POST /api/sightings
           |                                /    |  • POST /api/sightings/:id/confirm
           v                               v     +-----+------------+
+--------------------+                  +---------------+           |
|  OpenStreetMap     |                  |  MongoDB      |<----------+
|  (tile provider)   |                  |  • Sighting   |
+--------------------+                  |    documents  |
                                         |  • Geo index |
                                         +--------------+
```

**Notes**

- The API also serves the static frontend (HTML/CSS/JS) from `/public/`, keeping deployment simple.
- Sightings stored as GeoJSON Points with a 2dsphere index for future geo queries (e.g., map bounds).
- Credibility score = confirmation count (simple MVP). Extend later with time decay or user reputation.

---

## 2) Data Model

**Collection:** `sightings`

```json
{
  "_id": ObjectId,
  "lat": Number,
  "lng": Number,
  "location": { "type": "Point", "coordinates": [lng, lat] },
  "description": String,            // optional short note
  "photoUrl": String,               // optional, MVP trusts user input
  "confirmations": Number,          // starts at 0
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```

---

## 3) API Contract (MVP)

- `GET /api/health` → `{ ok: true }`
- `GET /api/sightings?since=ISO&bbox=minLng,minLat,maxLng,maxLat` → `[{ ...sighting }]`
- `POST /api/sightings` → body `{ lat: Number, lng: Number, description?: String, photoUrl?: String }` → `201 { sighting }`
- `POST /api/sightings/:id/confirm` → `200 { confirmations: Number }`

*All responses are JSON. Errors use standard HTTP codes and **`{ error: string }`**.*

---

## 4) Step‑by‑Step Tutorial

### Prerequisites

- Node.js ≥ 18 and npm
- A MongoDB instance (local or MongoDB Atlas)

### 4.1 Initialise the project

```bash
mkdir phoenix-deer && cd phoenix-deer
npm init -y
npm i express mongoose cors helmet morgan express-rate-limit dotenv
npm i -D nodemon
```

Add **scripts** to `package.json`:

```json
{
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js"
  }
}
```

Create `.env`:

```env
PORT=5173
MONGODB_URI=mongodb://localhost:27017/phoenix_deer
```

### 4.2 Backend: `server.js`

```js
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5173;
const MONGODB_URI = process.env.MONGODB_URI;

// --- Middleware
app.use(helmet());
app.use(morgan('tiny'));
app.use(express.json({ limit: '1mb' }));
app.use(cors());

// Basic rate-limiter (MVP)
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// --- Mongoose & Model
await mongoose.connect(MONGODB_URI, { dbName: 'phoenix_deer' });

const sightingSchema = new mongoose.Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [lng, lat]
  },
  description: { type: String, trim: true, maxlength: 300 },
  photoUrl: { type: String, trim: true },
  confirmations: { type: Number, default: 0, min: 0 }
}, { timestamps: true });

sightingSchema.index({ location: '2dsphere' });

const Sighting = mongoose.model('Sighting', sightingSchema);

// --- API Routes
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// List sightings (optionally by time and bbox)
app.get('/api/sightings', async (req, res) => {
  try {
    const { since, bbox } = req.query;
    const query = {};

    if (since) {
      const d = new Date(since);
      if (!isNaN(d)) query.createdAt = { $gte: d };
    }

    if (bbox) {
      const [minLng, minLat, maxLng, maxLat] = bbox.split(',').map(Number);
      if ([minLng, minLat, maxLng, maxLat].every(n => !isNaN(n))) {
        query.location = {
          $geoWithin: {
            $box: [[minLng, minLat], [maxLng, maxLat]]
          }
        };
      }
    }

    const docs = await Sighting.find(query).sort({ createdAt: -1 }).limit(500);
    res.json(docs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch sightings' });
  }
});

// Create a sighting
app.post('/api/sightings', async (req, res) => {
  try {
    const { lat, lng, description, photoUrl } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }

    const doc = await Sighting.create({
      lat, lng,
      location: { type: 'Point', coordinates: [lng, lat] },
      description: description?.toString().slice(0, 300),
      photoUrl: photoUrl?.toString().slice(0, 500)
    });

    res.status(201).json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create sighting' });
  }
});

// Confirm a sighting (upvote)
app.post('/api/sightings/:id/confirm', async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await Sighting.findByIdAndUpdate(
      id,
      { $inc: { confirmations: 1 } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json({ confirmations: updated.confirmations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm sighting' });
  }
});

// --- Static frontend
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/', express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
```

### 4.3 Frontend (static): `public/index.html`

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Phoenix Park Deer Tracker (MVP)</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body { height: 100%; margin: 0; }
    #map { height: 100%; }
    .banner { position: absolute; z-index: 1000; top: 10px; left: 10px; background: rgba(255,255,255,.95); padding: 8px 12px; border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,.1); font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
    .btn { cursor: pointer; padding: 6px 10px; border-radius: 8px; border: 1px solid #ddd; background: #fff; }
    .popup-btn { display:inline-block; margin-top:6px; padding:4px 8px; border:1px solid #ccc; border-radius:6px; cursor:pointer; }
  </style>
</head>
<body>
  <div class="banner">
    <strong>🦌 Phoenix Park Deer Tracker</strong><br />
    Click on the map to add a sighting. Tap a marker → <em>Confirm</em> to upvote credibility.
  </div>
  <div id="map"></div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // --- Map init (center on Phoenix Park, Dublin)
    const map = L.map('map');
    const phoenixBounds = L.latLngBounds([[53.341, -6.38], [53.372, -6.29]]); // rough bounds
    map.fitBounds(phoenixBounds);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const markers = new Map(); // id -> marker

    function markerPopupHtml(s) {
      const created = new Date(s.createdAt).toLocaleString();
      const desc = s.description ? `<div>${escapeHtml(s.description)}</div>` : '';
      const photo = s.photoUrl ? `<div style="margin-top:6px"><img src="${escapeHtml(s.photoUrl)}" alt="photo" style="max-width:200px;border-radius:6px"/></div>` : '';
      return `
        <div>
          <div><strong>Deer sighting</strong> · <small>${created}</small></div>
          ${desc}
          ${photo}
          <div style="margin-top:6px">Credibility: <strong id="cred-${s._id}">${s.confirmations}</strong></div>
          <button class="popup-btn" onclick="confirmSighting('${s._id}')">Confirm</button>
        </div>
      `;
    }

    function addOrUpdateMarker(s) {
      const latlng = [s.lat, s.lng];
      if (markers.has(s._id)) {
        const m = markers.get(s._id);
        m.setPopupContent(markerPopupHtml(s));
        return m;
      }
      const m = L.marker(latlng).addTo(map);
      m.bindPopup(markerPopupHtml(s));
      markers.set(s._id, m);
      return m;
    }

    // Load sightings (optionally by current map bounds)
    async function loadSightings() {
      try {
        const b = map.getBounds();
        const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].join(',');
        const res = await fetch(`/api/sightings?bbox=${bbox}`);
        const data = await res.json();
        data.forEach(addOrUpdateMarker);
      } catch (e) { console.error(e); }
    }

    // Add new sighting on click
    map.on('click', async (ev) => {
      if (!phoenixBounds.contains(ev.latlng)) {
        alert('Please add sightings inside Phoenix Park.');
        return;
      }
      const description = prompt('Optional note about the sighting (e.g., herd size, behavior):');
      if (description === null) return;
      const payload = { lat: ev.latlng.lat, lng: ev.latlng.lng, description };
      try {
        const res = await fetch('/api/sightings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('Failed to save sighting');
        const s = await res.json();
        const m = addOrUpdateMarker(s);
        m.openPopup();
      } catch (e) {
        console.error(e); alert('Could not save sighting.');
      }
    });

    // Confirm button
    window.confirmSighting = async f
```
