# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Phoenix Park Deer Tracker — a crowdsourced web app for pinning and browsing deer sightings in Phoenix Park, Dublin. Users add sightings by clicking the map or tapping "Found a deer here!" (geolocation), and sightings can also be bulk-imported from Garmin GPX exports.

**Direct Garmin Connect API sync was tried and abandoned** — the unofficial `garmin-connect` npm package only supports Garmin's classic username/password login, not SSO/federated login (Google/Apple/etc.), which is what this project's Garmin account uses. Confirmed by an actual failed login attempt, not just reading docs. Don't re-attempt this without a different underlying library or the official Garmin Developer API (which requires applying for access and a public HTTPS webhook endpoint this local-only app doesn't have).

The actual application lives entirely under `phoenix-deer/`. The repo root's `package.json` is a vestigial leftover (a handful of stray deps, no scripts) — ignore it; it is not the app manifest.

## Commands

Run backend and frontend in separate terminals; there is no single combined dev script.

```bash
# Backend (Express API), from phoenix-deer/
npm run dev          # nodemon server.js, auto-restart
npm start             # node server.js

# Frontend (Vite + React), from phoenix-deer/client/
npm run dev           # Vite dev server on :5173
npm run build         # tsc -b && vite build
npm run lint          # eslint .
npm run preview
```

There are no automated tests in this project (backend or frontend).

Backend needs `phoenix-deer/.env` (see `phoenix-deer/.env.example`): `PORT` and `MONGODB_URI` (Mongo must be reachable; db name is hardcoded to `phoenix_deer` in `server.js` via `mongoose.connect(..., { dbName: 'phoenix_deer' })`, independent of whatever db name is in the URI). **`.env` is gitignored — never commit it** (it was accidentally tracked and pushed early in this repo's history; that leak has since been rotated and scrubbed from git history, but don't repeat it).

Open the app at `http://localhost:5173`.

## Architecture

**Backend — single-file Express app (`phoenix-deer/server.js`)**. Everything lives in this one file: middleware setup, the Mongoose `Sighting` schema/model, GPX parsing, all routes. There's no router/controller/model split to navigate — read this file directly rather than searching for a structure that doesn't exist.

- `Sighting` schema: `{ lat, lng, description, location, createdAt, updatedAt }`. `location` is a GeoJSON `Point` (`[lng, lat]`) with a `2dsphere` index, used for proximity-based dedup via `$near` — not just lat/lng scalars filtered in application code. A startup migration backfills `location` on any doc saved before this index existed.
- Routes: `GET/POST /api/sightings`, `POST /api/import-gpx` (multer file upload), `POST /api/import-garmin` (reads all `.gpx` from a local `Garmin/GPX/` folder one level above `phoenix-deer/`), `GET /api/import-stats`.
- `saveSightingsFromFile()` is the shared import path used by every GPX-based route. Dedup is two-layered: within a single import batch (in-memory Haversine check against sightings already queued from the same file, so two near-duplicate waypoints in one GPX don't both insert), then against the DB via an indexed `$near` query (`DEDUP_RADIUS_METERS = 15`) plus exact `createdAt` match. `POST /api/sightings` (manual map-click/geolocation submissions) has its own dedup since it has no caller-set timestamp to match exactly: a `$near` query within a short rolling window (`MANUAL_DUPLICATE_WINDOW_MS = 10s`) catches accidental double-submits and returns the existing doc instead of creating a new one.
- `parseGPXFile()` looks for `<wpt>` entries first, then falls back to track points, then route points. It flags entries as deer sightings by matching the word "deer" (and translations) in the waypoint name/description, replacing the description with a 🦌 emoji string when matched.
- Static frontend build is served from `phoenix-deer/public/` by the same Express app in production, but there's no build step in `server.js`/npm scripts that populates `public/` from `client/` — that wiring doesn't currently exist, so don't assume `npm run build` in `client/` deploys automatically.

**Frontend — single-component React app (`phoenix-deer/client/src/App.tsx`)**. Nearly all state and logic lives in this one component: fetching sightings, the "add marker on click" map handler, geolocation "found a deer here" button, Garmin import trigger, date filtering (Today/This Month/This Year/All), and proximity-based marker clustering (a custom Haversine-distance grouping within 100m — this is separate from and not the same as `leaflet.markercluster`, which is a dependency but not wired into `App.tsx`).

- All fetches use relative `/api/...` paths, routed through the Vite dev proxy (`vite.config.ts`, proxying `/api` → `http://localhost:5050`) in dev, and same-origin when served from `public/` in production.
- Marker grouping/clustering (`groupSightings`) runs on every render over the currently filtered sightings — fine at current data volumes (~tens of records) but worth knowing if this becomes a perf question later.

**Adjacent untracked directories** — `Garmin/` (raw GPX exports consumed by `/api/import-garmin`) and `solid-data-wallet/` (an unrelated Expo/React Native project) sit in the repo working tree but aren't part of DeerFinder's git history. Don't treat code in `solid-data-wallet/` as part of this app.
