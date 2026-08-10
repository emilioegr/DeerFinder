import garminConnectPkg from 'garmin-connect';
const { GarminConnect } = garminConnectPkg;
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_DIR = path.join(__dirname, '.garmin-token');

// Cached for the life of the process so we don't re-login (and risk Garmin
// flagging repeated logins) on every button click.
let cachedClient = null;

async function getClient() {
  const { GARMIN_USERNAME, GARMIN_PASSWORD } = process.env;
  if (!GARMIN_USERNAME || !GARMIN_PASSWORD) {
    const err = new Error('GARMIN_USERNAME and GARMIN_PASSWORD must be set in phoenix-deer/.env');
    err.code = 'MISSING_CREDENTIALS';
    throw err;
  }

  if (cachedClient) return cachedClient;

  const gc = new GarminConnect({ username: GARMIN_USERNAME, password: GARMIN_PASSWORD });

  if (fs.existsSync(TOKEN_DIR)) {
    try {
      gc.loadTokenByFile(TOKEN_DIR);
      await gc.getUserSettings(); // cheap call to confirm the loaded token still works
      cachedClient = gc;
      return cachedClient;
    } catch {
      // Cached token expired/invalid - fall through to a fresh login below.
    }
  }

  try {
    await gc.login();
  } catch (err) {
    const loginErr = new Error(
      `Garmin login failed: ${err.message || err}. If the account has MFA/2FA enabled, ` +
      'this integration cannot support it (unimplemented in the underlying garmin-connect library).'
    );
    loginErr.code = 'LOGIN_FAILED';
    loginErr.cause = err;
    throw loginErr;
  }

  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  gc.exportTokenToFile(TOKEN_DIR);
  cachedClient = gc;
  return cachedClient;
}

function fileHasWaypoints(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return /<wpt[\s>]/.test(content);
}

// Downloads GPX for the most recent `limit` activities into destDir, keeping
// only files that contain explicit <wpt> markers (curated points of interest)
// and discarding plain GPS tracks - see server.js parseGPXFile's
// `waypointsOnly` option for why: an ordinary run/walk has no waypoints and
// would otherwise flood the map with hundreds of track-point "sightings".
export async function downloadRecentWaypointGpx(destDir, limit = 20) {
  const gc = await getClient();
  const activities = await gc.getActivities(0, limit);

  const files = [];
  let activitiesWithWaypoints = 0;

  for (const activity of activities) {
    const filePath = path.join(destDir, `${activity.activityId}.gpx`);
    try {
      await gc.downloadOriginalActivityData({ activityId: activity.activityId }, destDir, 'gpx');
      if (fs.existsSync(filePath) && fileHasWaypoints(filePath)) {
        files.push(filePath);
        activitiesWithWaypoints++;
      } else if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`Failed to download Garmin activity ${activity.activityId}:`, err.message || err);
    }
  }

  return {
    files,
    activitiesFetched: activities.length,
    activitiesWithWaypoints,
  };
}
