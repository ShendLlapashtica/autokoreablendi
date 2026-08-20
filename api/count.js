// Returns just the total count for a given filter — cheap prefetch for pagination UI
import { checkApiKey } from '../src/lib/rateLimit.js';
import { cacheGet, cacheSet } from '../src/lib/serverCache.js';

const CACHE_KEY = 'autovg:cache:count:total';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9',
  'Referer': 'https://www.encar.com/',
  'Origin': 'https://www.encar.com',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!await checkApiKey(req, res)) return;

  const encarUrl = `https://api.encar.com/search/car/list/general?${new URLSearchParams({
    count: 'true',
    q: '(And.Hidden.N.)',
    sr: '|ModifiedDate|0|1',
    inav: '|Metadata|Sort',
  })}`;

  // See api/cars.js — a blocked `direct` attempt hangs instead of failing
  // fast, so this is the real latency ceiling per request, kept short.
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  const enc   = encodeURIComponent(encarUrl);

  // A plain fetch() *fulfills* on any HTTP response, including a proxy's own
  // 429/error page — without checking r.ok, Promise.any can pick a fast,
  // non-JSON error response as the "winner" over a slower real success.
  function okOnly(p) {
    return p.then(r => r.ok ? r : Promise.reject(new Error(`HTTP ${r.status}`)));
  }

  try {
    const r = await Promise.any([
      okOnly(fetch(encarUrl, { signal: ctrl.signal, headers: BROWSER_HEADERS })),
      okOnly(fetch(`https://api.allorigins.win/get?url=${enc}`, { signal: ctrl.signal })),
      okOnly(fetch(`https://api.cors.lol/?url=${enc}`, { signal: ctrl.signal })),
    ]);
    clearTimeout(timer);
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = JSON.parse(JSON.parse(text).contents); }
    await cacheSet(CACHE_KEY, { total: data.Count });
    return res.status(200).json({ total: data.Count });
  } catch {
    clearTimeout(timer);
    const cached = await cacheGet(CACHE_KEY);
    if (cached) return res.status(200).json({ total: cached.total, stale: true, cachedAt: cached.ts });
    return res.status(502).json({ error: 'count fetch failed' });
  }
}
