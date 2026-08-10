import 'dotenv/config'; // this module reads process.env at import time, which
// ESM evaluates before server.js's own dotenv.config() call runs - load env
// here too so MONGODB_URI/SESSION_SECRET are populated regardless of order.
import express from 'express';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// resave/saveUninitialized both false: a session is only ever created (and a
// cookie sent) once someone actually logs in, so the vast majority of public
// visitors - who only ever hit the sightings routes - never touch this store.
export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    dbName: 'phoenix_deer',
    collectionName: 'sessions',
    ttl: SEVEN_DAYS_MS / 1000,
  }),
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SEVEN_DAYS_MS,
  },
});

export function requireAdmin(req, res, next) {
  if (req.session?.isAdmin) return next();
  res.status(401).json({ error: 'Admin login required' });
}

// Separate, stricter limiter than the blanket /api/ one - this route is the
// single gate protecting every admin action, so it's worth throttling harder.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const adminRouter = express.Router();

adminRouter.post('/login', loginLimiter, async (req, res) => {
  try {
    const hash = process.env.ADMIN_PASSWORD_HASH;
    if (!hash) {
      return res.status(500).json({ error: 'ADMIN_PASSWORD_HASH is not configured in .env' });
    }

    const { password } = req.body;
    if (typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const valid = await bcrypt.compare(password, hash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // Regenerate to get a fresh session id on login (avoids session fixation).
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Login failed' });
      req.session.isAdmin = true;
      res.json({ success: true });
    });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

adminRouter.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

adminRouter.get('/me', (req, res) => {
  res.json({ isAdmin: !!req.session?.isAdmin });
});
