// Price-drop tracking for live-only keys.
//
// Encar keeps no price history: a listing carries only its current Price
// (checked 2026-10-02 -- search row, readside record and inspection record).
// So drops are recorded here: every live row a live-only key receives has its
// price remembered with when it was seen, and a later, lower price for the
// same car is a drop.
//
// Redis layout (Upstash REST, same store as rate limiting):
//   autovg:px:<id>    -> "<price>|<lastSeenMs>"   last price and when it was seen
//   autovg:pxl:<id>   -> "<ms>"                   (baseline only) when a lower
//                                                 price was first seen in the cache
//   autovg:pxd:<id>   -> "<from>|<to>|<droppedMs>|<fromSeenMs>"   latest drop (30 days)
//   autovg:pxdrops    -> sorted set, member <id>, score = drop time (ms)
//
// Upstash bills every command, pipelined or not, so a whole response is read
// with one MGET and written with one MSET; per-car commands are spent only on
// actual drops.
//
// Timestamps say what is known, no more: previousPriceSeenAt is the last time
// the higher price was seen; droppedAt is the first time the lower one was.
// The drop itself happened between the two.

const DROP_TTL = 30 * 24 * 3600;

function creds() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

function readResult(item) {
  if (Array.isArray(item)) return item[1];
  if (item && typeof item === 'object') return item.result;
  return item;
}

async function pipe(cmds) {
  const c = creds();
  if (!c || !cmds.length) return null;
  try {
    const r = await fetch(`${c.url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data) ? data.map(readResult) : null;
  } catch {
    return null;
  }
}

const iso = (ms) => (Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null);

function dropOut(from, droppedMs, seenMs) {
  return { previousPrice: from, previousPriceSeenAt: iso(seenMs), droppedAt: iso(droppedMs) };
}

/**
 * Records the prices of these live rows and returns them annotated: a row
 * whose price is below the last one seen carries
 * priceDrop { previousPrice, previousPriceSeenAt, droppedAt }.
 * Never throws; without Redis the rows come back unchanged.
 */
export async function trackPrices(rows) {
  const list = (rows || []).filter(c => c && c.Id != null && Number.isFinite(Number(c.Price)));
  if (!list.length) return rows;
  const got = await pipe([['MGET', ...list.flatMap(c => [`autovg:px:${c.Id}`, `autovg:pxd:${c.Id}`, `autovg:pxl:${c.Id}`])]]);
  const values = got?.[0];
  if (!Array.isArray(values)) return rows;

  const now = Date.now();
  const writes = [];
  const priceSets = [];
  const drops = new Map();
  list.forEach((car, i) => {
    const price = Number(car.Price);
    const [lastP, lastSeen] = values[3 * i] != null ? String(values[3 * i]).split('|').map(Number) : [null, null];
    const prev = values[3 * i + 1];
    const lowerSeen = values[3 * i + 2] != null ? Number(values[3 * i + 2]) : null;
    let drop = null;
    if (prev) {
      const [from, to, at, seen] = String(prev).split('|').map(Number);
      // A recorded drop holds while the price stays at or below where it fell to.
      if (price <= to) drop = dropOut(from, at, seen);
    }
    if (lastP != null && price < lastP) {
      const from = drop ? drop.previousPrice : lastP;
      const seenMs = drop ? Date.parse(drop.previousPriceSeenAt) : lastSeen;
      // When the cache already showed the lower price, that is when it was first seen.
      const droppedMs = lowerSeen && lowerSeen > (lastSeen || 0) ? lowerSeen : now;
      drop = dropOut(from, droppedMs, seenMs);
      writes.push(['SET', `autovg:pxd:${car.Id}`, `${from}|${price}|${droppedMs}|${seenMs || ''}`, 'EX', DROP_TTL]);
      writes.push(['ZADD', 'autovg:pxdrops', droppedMs, String(car.Id)]);
    } else if (prev && !drop) {
      // Price went back up above the drop: no longer a reduced car.
      writes.push(['DEL', `autovg:pxd:${car.Id}`]);
      writes.push(['ZREM', 'autovg:pxdrops', String(car.Id)]);
    }
    if (lowerSeen != null) writes.push(['DEL', `autovg:pxl:${car.Id}`]);
    priceSets.push(`autovg:px:${car.Id}`, `${price}|${now}`);
    if (drop) drops.set(car.Id, drop);
  });
  writes.unshift(['MSET', ...priceSets]);
  // Drops older than the drop TTL leave the index too.
  writes.push(['ZREMRANGEBYSCORE', 'autovg:pxdrops', '-inf', String(now - DROP_TTL * 1000)]);
  await pipe(writes);

  return rows.map(c => (drops.has(c.Id) ? { ...c, priceDrop: drops.get(c.Id) } : c));
}

/** Ids of cars whose price dropped within the window, newest drop first. */
export async function recentDropIds(sinceMs, limit = 5000) {
  const got = await pipe([['ZRANGE', 'autovg:pxdrops', '+inf', String(sinceMs), 'BYSCORE', 'REV', 'LIMIT', '0', String(limit)]]);
  const ids = got?.[0];
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : null;
}

// ── Baseline from the search cache ────────────────────────────────────────
//
// Tracking can only see a drop once it knows an earlier price. The site's
// search cache (serverCache.js, kept 14 days) already holds earlier prices:
// every cached search result carries each car's Price at the time it was
// cached. Seeding the baseline from it means drops from the last two weeks
// are found on the first checks instead of only from today on.
//
// Per car: the earliest cached price is the baseline, with the last time it
// was seen at that price; if a later cache entry already shows it lower, that
// entry's time is when the lower price was first seen.
//
//   autovg:pxseed:v2     -> number of cars seeded (set when done)
//   autovg:pxseed:queue  -> list of seeded car ids still to re-check live

const SEED_DONE  = 'autovg:pxseed:v2';
const SEED_QUEUE = 'autovg:pxseed:queue';
const SEED_LOCK  = 'autovg:pxseed:lock';

export async function seedFromCache() {
  const [done, lock] = (await pipe([['GET', SEED_DONE], ['SET', SEED_LOCK, '1', 'NX', 'EX', '300']])) || [];
  if (done || lock !== 'OK') return;

  // v1 recorded detection time as the drop time; its drops are rebuilt here.
  await pipe([['DEL', 'autovg:pxdrops', SEED_QUEUE]]);

  const keys = [];
  let cursor = '0';
  for (let i = 0; i < 50; i++) {
    const got = await pipe([['SCAN', cursor, 'MATCH', 'autovg:cache:cars*', 'COUNT', '1000']]);
    const res = got?.[0];
    if (!Array.isArray(res)) break;
    cursor = String(res[0]);
    keys.push(...(res[1] || []));
    if (cursor === '0') break;
  }

  // Every (time, price) the cache holds for each car.
  const seen = new Map();
  for (let i = 0; i < keys.length; i += 20) {
    const vals = (await pipe([['MGET', ...keys.slice(i, i + 20)]]))?.[0] || [];
    for (const raw of vals) {
      let entry; try { entry = JSON.parse(raw); } catch { continue; }
      if (!Number.isFinite(entry?.ts)) continue;
      for (const c of entry.results || []) {
        const p = Number(c?.Price);
        if (c?.Id == null || !Number.isFinite(p)) continue;
        if (!seen.has(c.Id)) seen.set(c.Id, []);
        seen.get(c.Id).push([entry.ts, p]);
      }
    }
  }

  const ids = [...seen.keys()];
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const sets = [], lows = [], dels = [];
    for (const id of slice) {
      const obs = seen.get(id).sort((a, b) => a[0] - b[0]);
      const base = obs[0][1];
      const firstLower = obs.find(([, p]) => p < base);
      const lastAtBase = obs.filter(([t, p]) => p === base && (!firstLower || t < firstLower[0])).pop();
      sets.push(`autovg:px:${id}`, `${base}|${lastAtBase[0]}`);
      if (firstLower) lows.push(`autovg:pxl:${id}`, String(firstLower[0]));
      dels.push(`autovg:pxd:${id}`);
    }
    await pipe([
      ['MSET', ...sets],
      ...(lows.length ? [['MSET', ...lows]] : []),
      ['DEL', ...dels],
      ['RPUSH', SEED_QUEUE, ...slice.map(String)],
    ]);
  }
  await pipe([['SET', SEED_DONE, String(ids.length)], ['DEL', SEED_LOCK]]);
}

/** Up to n seeded ids still waiting for their live re-check. */
export async function nextSeedIds(n) {
  const got = await pipe([['LPOP', SEED_QUEUE, String(n)]]);
  const ids = got?.[0];
  return Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : [];
}

/** How many seeded ids are still waiting. */
export async function seedRemaining() {
  const got = await pipe([['LLEN', SEED_QUEUE]]);
  return Number(got?.[0]) || 0;
}
