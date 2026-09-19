process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.local';
process.env.UPSTASH_REDIS_REST_TOKEN = 'faketoken';

const CARS = Array.from({ length: 24 }, (_, i) => ({
  Id: String(40000000 + i), Manufacturer: '비엠더블유', Model: '5시리즈',
  Price: 2000 + i, Year: 202001, Mileage: 10000 + i, FuelType: '가솔린',
  Photos: [{ type: '001', location: '/x.jpg' }], Condition: ['Inspection'],
}));
const THIRTEEN_DAYS = Date.now() - 13 * 24 * 3600 * 1000;

// Scenario is set per-run; controls what the fake Redis returns.
let CACHE = {};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('/pipeline')) {
    const cmds = JSON.parse(opts.body);
    const out = cmds.map(([verb, key]) => {
      if (verb !== 'GET') return { result: 'OK' };
      const hit = CACHE[key];
      return { result: hit ? JSON.stringify(hit) : null };
    });
    return { ok: true, status: 200, json: async () => out, text: async () => JSON.stringify(out) };
  }
  // Every Encar path fails — today's real production condition.
  const e = new TypeError('fetch failed');
  e.cause = { code: 'ECONNRESET', message: 'socket hang up' };
  throw e;
};

const { default: handler } = await import(new URL('../api/cars.js', import.meta.url).href);
const { cacheKeyFromQuery } = await import(new URL('../src/lib/serverCache.js', import.meta.url).href);

function mkRes() {
  const r = { headers: {}, statusCode: null, body: null };
  return {
    setHeader: (k, v) => { r.headers[k] = v; },
    status(c) { r.statusCode = c; return this; },
    json(b) { r.body = b; return this; },
    end() { return this; },
    _r: r,
  };
}

async function run(name, query, cache) {
  CACHE = cache;
  const req = { method: 'GET', query, headers: { origin: 'https://autokoreablendi.com' } };
  const res = mkRes();
  await handler(req, res);
  const { statusCode, body, headers } = res._r;
  const n = body?.results?.length ?? 0;
  console.log(`\n--- ${name}`);
  console.log(`  HTTP ${statusCode}   cars returned: ${n}   ${n > 0 ? 'CARS PRESENT' : '*** NO CARS ***'}`);
  console.log(`  stale=${body?.stale} filtersApplied=${body?.filtersApplied} retryFromBrowser=${body?.retryFromBrowser ? 'yes' : 'NO'}`);
  console.log(`  Warning=${headers['Warning'] || '-'} X-Data-Stale=${headers['X-Data-Stale'] || '-'}`);
  console.log(`  detail=${String(body?.detail || '').slice(0, 90)}`);
  return { statusCode, n, body };
}

const exactKey = cacheKeyFromQuery('autovg:cache:cars', { q: 'bmw', count: '5', page: '0' });
const unfilteredKey = cacheKeyFromQuery('autovg:cache:cars', {});

const a = await run('A: exact query cached, 13 days old, all upstreams dead',
  { q: 'bmw', count: '5', page: '0' },
  { [exactKey]: { total: 999, results: CARS, ts: THIRTEEN_DAYS } });

const b = await run('B: query never cached, unfiltered cache exists (filters dropped)',
  { q: 'bmw', count: '5', page: '0' },
  { [unfilteredKey]: { total: 157489, results: CARS, ts: THIRTEEN_DAYS } });

const c = await run('C: plain homepage browse, unfiltered cache',
  { page: '0', count: '24' },
  { [unfilteredKey]: { total: 157489, results: CARS, ts: THIRTEEN_DAYS } });

console.log('\n================ VERDICT ================');
const fails = [];
if (a.statusCode !== 200 || a.n === 0) fails.push('A lost cars');
if (b.statusCode !== 200 || b.n === 0) fails.push('B lost cars');
if (c.statusCode !== 200 || c.n === 0) fails.push('C lost cars');
if (!a.body?.retryFromBrowser) fails.push('A missing retryFromBrowser (the fix)');
console.log(fails.length ? 'FAIL: ' + fails.join(' | ') : 'PASS — every path returns HTTP 200 with cars present');
