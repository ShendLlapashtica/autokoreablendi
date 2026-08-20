// Temporary resilience layer for /api/cars outages (Encar + its CORS-proxy
// fallbacks all down at once, 2026-08-20) — not a fix for the outage
// itself, just stops the site going blank while it lasts. Each distinct
// query (including page number) gets its own cached copy of the last
// successful response, keyed by the exact query string sent to the API.
const PREFIX = 'autovg:cache:';

export function readCarsCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeCarsCache(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ ...value, ts: Date.now() }));
  } catch {
    // Storage full or unavailable (private browsing) — degrade silently,
    // this is a best-effort fallback, not a required feature.
  }
}
