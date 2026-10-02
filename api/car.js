// Single car detail — tries Encar view endpoint, falls back to list search
import { checkApiKey } from '../src/lib/rateLimit.js';
import { withPower } from '../src/lib/power.js';
import { noisyFields, majorityMerge } from '../src/lib/encarClean.js';
import { trackPrices } from '../src/lib/priceTrack.js';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8',
  'Referer': 'https://www.encar.com/',
  'Origin': 'https://www.encar.com',
};

// See api/cars.js for what this is and why (verified live 2026-08-20).
const DENO_RELAY = 'https://autokoreablendi-encar-relay.shendllapashtica.deno.net/';
const DENO_RELAY_HEADERS = { 'x-relay-secret': process.env.DENO_RELAY_SECRET || '' };

async function tryFetch(url, signal, isWrapped = false, extraHeaders = null) {
  const r = await fetch(url, { signal, headers: extraHeaders ?? (isWrapped ? {} : BROWSER_HEADERS) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  if (isWrapped) {
    const outer = JSON.parse(text);
    if (!outer.contents) throw new Error('no contents');
    return JSON.parse(outer.contents);
  }
  return JSON.parse(text);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!await checkApiKey(req, res)) return;

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'missing id' });

  // See api/cars.js — a blocked `direct` attempt hangs instead of failing
  // fast, so this is the real latency ceiling per request, kept short.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);

  // Strategy 1: Encar dedicated view endpoint
  const viewUrl = `https://api.encar.com/search/car/view/general?carid=${id}`;
  // Strategy 2: List search filtered by ID (always works if listing API works)
  const listUrl = `https://api.encar.com/search/car/list/general?${new URLSearchParams({
    count: 'true',
    q: `(And.Hidden.N._.CarId.${id}.)`,
    sr: `|ModifiedDate|0|1`,
    inav: '|Metadata|Sort',
  })}`;

  const enc1 = encodeURIComponent(viewUrl);
  const enc2 = encodeURIComponent(listUrl);

  try {
    const data = await Promise.any([
      // View endpoint — direct + proxied
      tryFetch(viewUrl, ctrl.signal),
      tryFetch(`https://api.allorigins.win/get?url=${enc1}`, ctrl.signal, true),
      // corsproxy.io rejects server-side callers on its free plan — dead
      // for this use case, see api/cars.js.
      tryFetch(`https://api.cors.lol/?url=${enc1}`, ctrl.signal),
      tryFetch(`${DENO_RELAY}?url=${enc1}`, ctrl.signal, false, DENO_RELAY_HEADERS),
      // List search fallback
      tryFetch(listUrl, ctrl.signal).then(d => {
        const car = d?.SearchResults?.[0];
        if (!car) throw new Error('not found in list');
        return car;
      }),
      tryFetch(`https://api.allorigins.win/get?url=${enc2}`, ctrl.signal, true).then(d => {
        const car = d?.SearchResults?.[0];
        if (!car) throw new Error('not found in list via proxy');
        return car;
      }),
      tryFetch(`${DENO_RELAY}?url=${enc2}`, ctrl.signal, false, DENO_RELAY_HEADERS).then(d => {
        const car = d?.SearchResults?.[0];
        if (!car) throw new Error('not found in list via denorelay');
        return car;
      }),
    ]);

    // Live-only key: Encar sometimes injects random characters into text
    // fields (see encarClean.js). A noisy record is fetched again; if it stays
    // noisy, each field is settled by majority across three fetches.
    if (req.liveOnly && noisyFields(data).length) {
      const again = () => Promise.any([
        tryFetch(listUrl, ctrl.signal),
        tryFetch(`${DENO_RELAY}?url=${enc2}`, ctrl.signal, false, DENO_RELAY_HEADERS),
      ]).then(d => d?.SearchResults?.[0] ?? null).catch(() => null);
      const second = await again();
      if (second && !noisyFields(second).length) Object.assign(data, second);
      else {
        const third = await again();
        const merged = majorityMerge([data, second, third].filter(Boolean).map(c => ({ SearchResults: [c] })));
        Object.assign(data, merged.SearchResults[0]);
      }
    }

    // Best-effort: the view/list endpoints above only carry a handful of
    // photos each. Encar's readside API exposes the full gallery (often
    // 20+ shots) — merge it in when available, but a failure here (it's
    // a separate, less reliable endpoint) must never break the response.
    try {
      const readsideUrl = `https://api.encar.com/v1/readside/vehicle/${id}`;
      const full = await Promise.any([
        tryFetch(readsideUrl, ctrl.signal),
        tryFetch(`${DENO_RELAY}?url=${encodeURIComponent(readsideUrl)}`, ctrl.signal, false, DENO_RELAY_HEADERS),
      ]);
      // Live-only: when the car was first advertised and whether Encar shows
      // it as reserved (manage block; posting time is Korean local time).
      if (req.liveOnly && full?.manage) {
        const at = full.manage.firstAdvertisedDateTime || full.manage.registDateTime;
        if (at) data.postedAt = new Date(`${at}+09:00`).toISOString();
        data.reserved = !!full.manage.webReserved;
      }
      if (Array.isArray(full?.photos) && full.photos.length > 0) {
        data.Photos = full.photos
          .slice()
          .sort((a, b) => parseInt(a.code) - parseInt(b.code))
          .map(p => ({ location: p.path }));
      }
    } catch {}

    clearTimeout(timer);
    // A live-only key gets the same live markers as /api/cars: fetched from
    // Encar for this request, never cached on the way.
    if (req.liveOnly) {
      const fetchedAt = new Date().toISOString();
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Data-Live', 'true');
      res.setHeader('X-Data-Fetched-At', fetchedAt);
      const [tracked] = await trackPrices([data]);
      return res.status(200).json({ ...withPower(tracked), live: true, fetchedAt });
    }
    return res.status(200).json(withPower(data));
  } catch (err) {
    clearTimeout(timer);
    if (req.liveOnly) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Retry-After', '30');
      return res.status(503).json({
        error: 'Live data is momentarily unavailable. Retry shortly.',
        code:  'LIVE_UNAVAILABLE',
        live:  false,
      });
    }
    // Same recovery the listing uses: when every server route to Encar is
    // blocked, hand the browser the URL we could not reach. A visitor's IP is
    // not on Encar's blocklist. Without this a SHARED LINK to a car opens on
    // "not found" while the data is one fetch away -- and a shared link is
    // exactly how a listing travels from an importer to their customer.
    //
    // listUrl, not viewUrl: /view/general does NOT send
    // Access-Control-Allow-Origin, so a browser fetch of it dies on CORS
    // (verified live: "TypeError: Failed to fetch"). /list/general does, and
    // filtered to this CarId it returns the same vehicle.
    return res.status(502).json({
      error: 'Could not fetch car detail',
      detail: err.message,
      retryFromBrowser: listUrl,
    });
  }
}
