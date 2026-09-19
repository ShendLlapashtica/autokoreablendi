// Warm the server cache from a RESIDENTIAL connection.
//
// Encar blocks datacenter egress -- AWS, Cloudflare, Vercel and Deno Deploy
// all confirmed blocked, while a home connection is answered normally. So
// /api/cars cannot refresh its own cache and has been serving a 2026-09-06
// snapshot: a partner's `manufacturer=BMW&count=200` request fell through to
// the unfiltered fallback and received 24 cars of mixed makes.
//
// This closes that loop WITHOUT exposing anything. The machine does not need
// to be reachable -- it fetches Encar over its own connection and writes
// OUTBOUND to Upstash over HTTPS, into the exact keys api/cars.js reads. No
// tunnel, no inbound port, no relay to keep alive.
//
// Keys must match byte for byte what the handler computes, which is why the
// key is built with the handler's own cacheKeyFromQuery rather than a string
// assembled here: a key that differs by one param silently warms nothing.
import { cacheSet, cacheKeyFromQuery, cacheGet } from '../src/lib/serverCache.js';
import { buildEncarUrl, MANUFACTURER_REVERSE } from '../api/cars.js';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.encar.com/',
  Origin: 'https://www.encar.com',
};

const YEAR_FROM = 2016;
const PREFIX = 'autovg:cache:cars';

async function encar(parts, offset, count) {
  const url = buildEncarUrl(parts, offset, count, 'ModifiedDate');
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j?.SearchResults)) throw new Error('no SearchResults');
  return j;
}

// A warm must never make things worse. An entry is only replaced when the
// new copy actually has cars; a failed or empty fetch leaves the existing
// (stale but populated) entry untouched, so no run of this script can empty
// the grid.
async function warm(label, query, parts, offset, count) {
  const key = cacheKeyFromQuery(PREFIX, query);
  try {
    const j = await encar(parts, offset, count);
    if (!j.SearchResults.length) { console.log(`  skip  ${label} -- upstream returned 0`); return false; }
    await cacheSet(key, { total: j.Count, results: j.SearchResults });
    console.log(`  ok    ${label.padEnd(26)} ${String(j.SearchResults.length).padStart(3)} cars  total ${j.Count}`);
    return true;
  } catch (e) {
    const had = await cacheGet(key).catch(() => null);
    console.log(`  FAIL  ${label.padEnd(26)} ${e.message}${had ? ' (kept existing entry)' : ''}`);
    return false;
  }
}

const yearPart  = `Year.range(${YEAR_FROM}00..203099)`;
// The handler always constrains price alongside year (visible in the
// retryFromBrowser URL it emits). Warming without it would store a DIFFERENT
// population under the key the handler later reads -- right key, wrong cars.
const pricePart = 'Price.range(201..999999)';
let ok = 0, n = 0;

console.log('unfiltered + site keys:');
// The last-resort key the handler falls back to when a query was never cached.
n++; if (await warm('unfiltered fallback', {}, [yearPart, pricePart], 0, 200)) ok++;
// The homepage's own request shape.
n++; if (await warm('homepage page0/24', { page: '0', count: '24' }, [yearPart, pricePart], 0, 24)) ok++;

console.log('\nper-manufacturer (partner sync shape: page0 count200 yearFrom2016):');
for (const [name, kr] of Object.entries(MANUFACTURER_REVERSE)) {
  const query = { page: '0', count: '200', yearFrom: String(YEAR_FROM), manufacturer: name };
  n++; if (await warm(name, query, [`Manufacturer.${kr}`, yearPart, pricePart], 0, 200)) ok++;
  await new Promise(r => setTimeout(r, 250)); // be polite to upstream
}

console.log(`\ndone: ${ok}/${n} keys warmed`);
