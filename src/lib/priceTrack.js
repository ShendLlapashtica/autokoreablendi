// Price-drop tracking for live-only keys.
//
// Encar keeps no price history: a listing carries only its current Price
// (checked 2026-10-02 -- search row, readside record and inspection record).
// So drops are recorded here: every live row a live-only key receives has its
// price remembered, and a later, lower price for the same car is a drop.
//
// Redis layout (Upstash REST, same store as rate limiting):
//   autovg:px:<id>     -> "<price>"            last price seen
//   autovg:pxd:<id>    -> "<from>|<to>|<ms>"   the latest drop   (TTL 30 days)
//   autovg:pxdrops     -> sorted set, member <id>, score = drop time (ms)
// Upstash bills every command, pipelined or not, so the prices of a whole
// response are read with one MGET and written with one MSET (only the ones
// that are new or changed). Per-car commands are spent only on actual drops.

const DROP_TTL  = 30 * 24 * 3600;

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

/**
 * Records the prices of these live rows and returns them annotated: a row
 * whose price is below the last one seen (now or on an earlier request)
 * carries priceDrop { previousPrice, droppedAt }. Never throws; without
 * Redis the rows come back unchanged.
 */
export async function trackPrices(rows) {
  const list = (rows || []).filter(c => c && c.Id != null && Number.isFinite(Number(c.Price)));
  if (!list.length) return rows;
  const got = await pipe([['MGET', ...list.flatMap(c => [`autovg:px:${c.Id}`, `autovg:pxd:${c.Id}`])]]);
  const values = got?.[0];
  if (!Array.isArray(values)) return rows;

  const now = Date.now();
  const writes = [];
  const priceSets = [];
  const drops = new Map();
  list.forEach((car, i) => {
    const price = Number(car.Price);
    const last  = values[2 * i] != null ? Number(values[2 * i]) : null;
    const prev  = values[2 * i + 1];
    let drop = null;
    if (prev) {
      const [from, to, at] = String(prev).split('|').map(Number);
      // A recorded drop holds while the price stays at or below where it fell to.
      if (price <= to) drop = { previousPrice: from, droppedAt: new Date(at).toISOString() };
    }
    if (last != null && price < last) {
      const from = drop ? drop.previousPrice : last;
      drop = { previousPrice: from, droppedAt: new Date(now).toISOString() };
      writes.push(['SET', `autovg:pxd:${car.Id}`, `${from}|${price}|${now}`, 'EX', DROP_TTL]);
      writes.push(['ZADD', 'autovg:pxdrops', now, String(car.Id)]);
    } else if (prev && !drop) {
      // Price went back up above the drop: no longer a reduced car.
      writes.push(['DEL', `autovg:pxd:${car.Id}`]);
      writes.push(['ZREM', 'autovg:pxdrops', String(car.Id)]);
    }
    if (last !== price) priceSets.push(`autovg:px:${car.Id}`, String(price));
    if (drop) drops.set(car.Id, drop);
  });
  if (priceSets.length) writes.unshift(['MSET', ...priceSets]);
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
// cached. Seeding the baseline from it once means drops from the last two
// weeks are found on the first checks instead of only from today on.
//
//   autovg:pxseed:v1     -> number of cars seeded (set when done)
//   autovg:pxseed:queue  -> list of seeded car ids still to re-check live

const SEED_DONE  = 'autovg:pxseed:v1';
const SEED_QUEUE = 'autovg:pxseed:queue';
const SEED_LOCK  = 'autovg:pxseed:lock';

export async function seedFromCache() {
  const [done, lock] = (await pipe([['GET', SEED_DONE], ['SET', SEED_LOCK, '1', 'NX', 'EX', '300']])) || [];
  if (done || lock !== 'OK') return;

  // Every cached search result key.
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

  // The oldest price seen for each car across those results.
  const oldest = new Map();
  for (let i = 0; i < keys.length; i += 20) {
    const vals = (await pipe([['MGET', ...keys.slice(i, i + 20)]]))?.[0] || [];
    for (const raw of vals) {
      let entry; try { entry = JSON.parse(raw); } catch { continue; }
      for (const c of entry?.results || []) {
        const p = Number(c?.Price);
        if (c?.Id == null || !Number.isFinite(p)) continue;
        const prev = oldest.get(c.Id);
        if (!prev || entry.ts < prev.ts) oldest.set(c.Id, { p, ts: entry.ts });
      }
    }
  }

  const ids = [...oldest.keys()];
  for (let i = 0; i < ids.length; i += 1000) {
    const slice = ids.slice(i, i + 1000);
    await pipe([
      ['MSET', ...slice.flatMap(id => [`autovg:px:${id}`, String(oldest.get(id).p)])],
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
