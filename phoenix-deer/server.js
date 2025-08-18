import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5050;   // ✅ backend fixed to 5000
const MONGODB_URI = process.env.MONGODB_URI;

// --- CORS must be FIRST
//app.use(cors({
//  origin: "http://localhost:5173", // frontend dev server
//  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
//  allowedHeaders: ["Content-Type", "Authorization"],
//  credentials: true,
//}));

app.use(cors());


// Explicit preflight handling
//app.options("*", cors());

// --- Security & logging
app.use(helmet());
app.use(morgan('tiny'));
app.use(express.static(path.join(__dirname, 'public')));
//app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.json());

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
}, { timestamps: true });

const Sighting = mongoose.model('Sighting', sightingSchema);

// --- Routes
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/sightings', async (_req, res) => {
  const docs = await Sighting.find().sort({ createdAt: -1 }).limit(500);
  res.json(docs);
});

app.post('/api/sightings', async (req, res) => {
  const { lat, lng, description } = req.body;
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng are required numbers' });
  }
  const doc = await Sighting.create({ lat, lng, description });
  res.status(201).json(doc);
});

// --- Static frontend (later when deploying)

//app.use('/', express.static(path.join(__dirname, 'public')));

// ✅ Only ONE listen
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
