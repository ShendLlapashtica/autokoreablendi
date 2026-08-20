// Server-side last-known-good cache for /api/cars and /api/count.
//
// The client already has its own localStorage fallback (carsCache.js), but
// that only helps a visitor who has that exact query cached in their own
// browser already. During a live-fetch outage (Encar + all CORS-proxy
// fallbacks down at once, as first hit 2026-08-20), every *new* visitor —
// and every visitor trying a query they haven't run before — still gets a
// hard error. This caches the last successful response for a given query
// server-side (shared across all visitors) so any query that has ever
// succeeded once, for anyone, can serve a stale-but-real result instead.
//
// Reuses the same Upstash Redis REST API already wired up for rate limiting
// (see rateLimit.js). Gracefully degrades to a no-op if the env vars aren't
// set — a missing cache must never be why a request fails.
const TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days — long enough to ride out a multi-day outage

function creds() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redisPipeline(commands) {
  const c = creds();
  if (!c) return null;
  try {
    const res = await fetch(`${c.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
    });
    return await res.json();
  } catch {
    return null;
  }
}

export async function cacheGet(key) {
  const result = await redisPipeline([['GET', key]]);
  const raw = result?.[0]?.result;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function cacheSet(key, value) {
  await redisPipeline([['SET', key, JSON.stringify({ ...value, ts: Date.now() }), 'EX', String(TTL_SECONDS)]]);
}

// Stable key regardless of query-param insertion order, so the same
// filters always hit the same cache entry.
export function cacheKeyFromQuery(prefix, q) {
  const parts = Object.entries(q)
    .filter(([, v]) => v !== '' && v != null)
    .sort(([a], [b]) => a.localeCompare(b));
  return prefix + ':' + new URLSearchParams(parts).toString();
}
