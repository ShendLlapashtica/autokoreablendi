// One URL that answers "is the car feed actually live right now?"
//
// The 2026-09-19 incident was not that the feed broke -- feeds break. It was
// that breaking looked identical to working: /api/cars returned HTTP 200,
// the grid was full of cars, and nothing anywhere said those cars were from
// 6 September. It stayed that way for roughly two weeks. A failure that
// renders as success is a failure nobody reports.
//
// Deliberately not a scheduled job (this project runs none by standing
// decision). It is a page you open when something feels off, and it answers
// in one line instead of requiring someone to diff car IDs against Encar by
// hand the way this incident had to be diagnosed.
import { cacheGet, cacheKeyFromQuery } from '../src/lib/serverCache.js';
import { buildEncarUrl } from './cars.js';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.encar.com/',
  Origin: 'https://www.encar.com',
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  // Can THIS server reach Encar? Short timeout: the answer is yes or no, and
  // a slow no is still a no.
  let egress = { reachable: false, ms: null, error: null, liveCount: null };
  const t0 = Date.now();
  try {
    const r = await fetch(buildEncarUrl([], 0, 1, 'ModifiedDate'), {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(6000),
    });
    const body = await r.json();
    egress.ms = Date.now() - t0;
    egress.reachable = Number.isFinite(body?.Count);
    egress.liveCount = body?.Count ?? null;
    if (!egress.reachable) egress.error = `HTTP ${r.status}, no Count in body`;
  } catch (err) {
    egress.ms = Date.now() - t0;
    // err.cause carries the real reason; "fetch failed" alone says nothing.
    egress.error = [err?.message, err?.cause?.code, err?.cause?.message]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(': ');
  }

  // Which Encar hosts can this server open a socket to at all?
  //
  // api.encar.com is CloudFront (18.66.26.88) and that is where the
  // client-IP block lives. www/fem/m.encar.com answer on Korean AWS origin
  // IPs (15.165.21.222, 13.124.112.123) which are NOT CloudFront, so they may
  // not carry the same blocklist. Knowing which hosts are reachable from here
  // is what decides whether any server-side route exists at all -- worth far
  // more than another guess at a proxy.
  const hosts = ['api.encar.com', 'www.encar.com', 'fem.encar.com', 'm.encar.com'];
  const hostProbes = {};
  await Promise.all(hosts.map(async h => {
    const t = Date.now();
    try {
      const r = await fetch(`https://${h}/`, {
        method: 'GET',
        headers: { 'User-Agent': BROWSER_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(5000),
      });
      hostProbes[h] = { ok: true, status: r.status, ms: Date.now() - t };
    } catch (err) {
      hostProbes[h] = {
        ok: false,
        ms: Date.now() - t,
        error: [err?.message, err?.cause?.code].filter(Boolean).join(': '),
      };
    }
  }));

  // How old is what visitors are being served from cache?
  const cached = await cacheGet(cacheKeyFromQuery('autovg:cache:cars', {})).catch(() => null);
  const ageMs  = cached?.ts ? Date.now() - cached.ts : null;
  const ageHrs = ageMs != null ? +(ageMs / 3600000).toFixed(1) : null;

  // Browser recovery means the SITE can be fine while server egress is dead,
  // but a server-to-server consumer (a partner's sync job) only ever sees the
  // cache -- so these two are reported separately and never conflated.
  const verdict = egress.reachable
    ? 'LIVE — server reaches Encar; API consumers get fresh data'
    : ageHrs != null && ageHrs < 24
      ? 'DEGRADED — server cannot reach Encar; cache is recent; site live via browser recovery'
      : 'STALE — server cannot reach Encar and the cache is old; API consumers are receiving outdated listings';

  res.status(200).json({
    verdict,
    checkedAt: new Date().toISOString(),
    serverEgressToEncar: egress,
    hostProbes,
    serverCache: {
      cachedAt: cached?.ts ? new Date(cached.ts).toISOString() : null,
      ageHours: ageHrs,
      cars: cached?.results?.length ?? 0,
      total: cached?.total ?? null,
    },
    note: 'Site visitors get live data via browser recovery even when serverEgressToEncar.reachable is false. Partners syncing server-to-server do NOT.',
  });
}
