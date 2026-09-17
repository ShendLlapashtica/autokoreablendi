const BASE = import.meta.env.VITE_API_URL || '';

async function get(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== '' && v != null)
  ).toString();
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`;
  const r = await fetch(url);
  if (!r.ok) {
    // A failed response may still carry `retryFromBrowser` — the URL the
    // server could not reach but this browser can. Throwing it away here
    // would discard the only route to live data on a deployment with no cache
    // configured, which is exactly the case on the clone sites.
    const recoverable = await r.json().catch(() => null);
    if (recoverable?.retryFromBrowser) return recoverable;
    throw new Error(`API ${r.status}: ${path}`);
  }
  return r.json();
}

/**
 * Live results from the visitor's own connection when the server can't get them.
 *
 * On 2026-09-14 Encar's CloudFront WAF was blocking every server-side egress
 * this project has — Vercel, AWS, Cloudflare and Deno Deploy simultaneously —
 * while every free public CORS proxy was dead or gated. The server therefore
 * fell back to cached UNFILTERED inventory and flagged it `filtersApplied:
 * false`, which is honest but useless for an actual search.
 *
 * Encar serves `Access-Control-Allow-Origin: *`, and a residential connection
 * is not on that blocklist. So when the server degrades it returns the exact
 * Encar URL it could not reach, as `retryFromBrowser`, and we fetch it here.
 * Every visitor uses their own IP, which is why this cannot be blocked the way
 * a single relay can.
 *
 * Failure is silent by design: if the browser fetch fails too (offline,
 * extension blocking, Encar down), the caller keeps the server's cached
 * response with its flags intact, which is strictly better than an error.
 */
async function retryFromBrowser(payload) {
  if (!payload?.retryFromBrowser) return payload;
  try {
    const r = await fetch(payload.retryFromBrowser);
    if (!r.ok) return payload;
    const live = await r.json();
    if (!Array.isArray(live?.SearchResults)) return payload;
    return {
      total: live.Count ?? payload.total,
      page: payload.page,
      count: live.SearchResults.length,
      results: live.SearchResults,
      stale: false,
      filtersApplied: true,
      viaBrowser: true,
    };
  } catch {
    return payload;
  }
}

export async function fetchCars(filters = {}, page = 0, count = 24) {
  const payload = await get('/api/cars', { ...filters, page, count });
  return retryFromBrowser(payload);
}

export async function fetchCar(id) {
  return get('/api/car', { id });
}

export async function fetchInspect(id) {
  return get('/api/inspect', { id }).catch(() => null);
}

export async function fetchCount() {
  return get('/api/count').catch(() => ({ total: 0 }));
}
