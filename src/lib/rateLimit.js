// API key gate + rate limiting (100 req/day per key)
// Uses Upstash Redis REST API directly — no npm package needed
// Gracefully degrades: if env vars not set, just validates the key (no count enforcement)
//
// Supports handing out more than one free key, each with its own independent
// daily quota (so person A spamming never eats into person B's 100/day):
//   FRIEND_API_KEY   = single legacy key, counted under the "friend" label
//   FRIEND_API_KEYS  = "label1:key1,label2:key2,..." for additional people
// Revoke one person by deleting their entry — the others are unaffected.
//
// Paid keys (PAID_API_KEYS) are a separate tier for external, commercial
// use — a much higher ceiling than the free tier, but locked to a single
// origin domain so a leaked/shared key can't be reused on other sites:
//   PAID_API_KEYS = "label1:key1:domain1.com,label2:key2:domain2.com"
// Counted under their own Redis key prefix (autovg:paid:) so their volume
// never shares a bucket with, or can exhaust, the free-tier quotas above.

import { timingSafeEqual } from 'crypto';

const DAILY_LIMIT = 100;

// Not truly infinite — bounds the blast radius of a leaked paid key (and
// protects the shared Encar/CORS-proxy upstreams this site also depends on)
// while still being far beyond what a real car-listing site would ever hit.
// 200k/day matches the scale of this site's own listing volume, and is
// well above the ~172k/day an anonymous visitor's IP could already reach
// under IP_LIMIT_PER_MINUTE — so this is genuine parity with normal site
// traffic, not an artificial ceiling on the paid tier.
const PAID_DAILY_LIMIT = 200000;

// Generous per-IP cap on anonymous (no-key) traffic — high enough that a
// real visitor browsing/filtering/paginating the site never gets near it,
// but bounds how hard any single script can hammer the proxy (and, in
// turn, Encar's upstream API) without needing a key at all.
const IP_LIMIT_PER_MINUTE = 120;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function loadKeys() {
  const keys = new Map(); // key value -> label
  if (process.env.FRIEND_API_KEY) keys.set(process.env.FRIEND_API_KEY, 'friend');
  for (const pair of (process.env.FRIEND_API_KEYS || '').split(',')) {
    const [label, value] = pair.split(':').map(s => s?.trim());
    if (label && value) keys.set(value, label);
  }
  return keys;
}

function loadPaidKeys() {
  const keys = new Map(); // key value -> { label, domain }
  for (const entry of (process.env.PAID_API_KEYS || '').split(',')) {
    const [label, value, domain] = entry.split(':').map(s => s?.trim());
    if (label && value && domain) keys.set(value, { label, domain: domain.toLowerCase() });
  }
  return keys;
}

// Accepts a bare hostname match or any subdomain of it (e.g. an allowed
// domain of "encar-api.com" also covers "x.encar-api.com").
function hostnameAllowed(hostname, allowedDomain) {
  const h = hostname.toLowerCase();
  return h === allowedDomain || h.endsWith(`.${allowedDomain}`);
}

// Paid keys are meant to be called from browser JS on the client's own
// site, so a real browser sends Origin (cross-origin fetch/XHR) or, failing
// that, Referer — both are outside this server's control to fake from a
// genuine browser. This is the same "HTTP referrer restricted key" model
// Google Maps uses: it stops casual reuse/leakage onto other sites, not a
// determined attacker forging headers from a script.
function requestOrigin(req) {
  const origin = req.headers['origin'];
  if (origin) {
    try { return new URL(origin).hostname; } catch {}
  }
  const referer = req.headers['referer'];
  if (referer) {
    try { return new URL(referer).hostname; } catch {}
  }
  return null;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

async function redisIncr(key, ttlSeconds = 86400) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Redis not configured — skip counting

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, ttlSeconds],
      ]),
    });
    const data = await res.json();
    // Pipeline returns [[null, count], [null, 1]]
    return data?.[0]?.[1] ?? null;
  } catch {
    return null; // Redis error — don't block the request
  }
}

/**
 * Call at the top of every API handler that should be rate-limited.
 * Returns true  → request is allowed, continue
 * Returns false → response already sent (401 or 429), handler must return
 *
 * Normal website traffic (no x-api-key header) passes through unless it
 * trips the generous per-IP cap below — real visitors never notice it.
 */
export async function checkApiKey(req, res) {
  const key = (req.headers['x-api-key'] || '').trim();

  if (!key) {
    const bucket = Math.floor(Date.now() / 60000); // rolling 1-minute window
    const count  = await redisIncr(`autovg:ip:${clientIp(req)}:${bucket}`, 60);
    if (count !== null && count > IP_LIMIT_PER_MINUTE) {
      res.status(429).json({ error: 'Too many requests, slow down.' });
      return false;
    }
    return true;
  }

  // Paid keys are checked first and handled entirely separately — origin
  // enforcement, quota bucket, and response headers never touch the
  // free-tier path below, so paid-tier volume can't degrade it.
  for (const [validKey, { label, domain }] of loadPaidKeys()) {
    if (!safeEqual(key, validKey)) continue;

    const origin = requestOrigin(req);
    if (!origin || !hostnameAllowed(origin, domain)) {
      res.status(403).json({ error: `This key is only authorized for ${domain}.` });
      return false;
    }

    const today = new Date().toISOString().slice(0, 10);
    const count = await redisIncr(`autovg:paid:${label}:${today}`);
    if (count !== null) {
      res.setHeader('X-RateLimit-Limit',     String(PAID_DAILY_LIMIT));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, PAID_DAILY_LIMIT - count)));
      if (count > PAID_DAILY_LIMIT) {
        res.status(429).json({ error: 'Daily limit exceeded.', limit: PAID_DAILY_LIMIT, used: count });
        return false;
      }
    }
    return true;
  }

  let label = null;
  for (const [validKey, name] of loadKeys()) {
    if (safeEqual(key, validKey)) { label = name; break; }
  }
  if (!label) {
    res.status(401).json({ error: 'Invalid API key.' });
    return false;
  }

  // Valid key — check this person's own daily quota
  const today = new Date().toISOString().slice(0, 10); // e.g. "2026-06-30"
  const rKey  = `autovg:rl:${label}:${today}`;
  const count = await redisIncr(rKey);

  if (count !== null) {
    res.setHeader('X-RateLimit-Limit',     String(DAILY_LIMIT));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, DAILY_LIMIT - count)));
    res.setHeader('X-RateLimit-Reset',     'midnight UTC');

    if (count > DAILY_LIMIT) {
      res.status(429).json({
        error:    'Rate limit exceeded.',
        limit:    DAILY_LIMIT,
        used:     count,
        resetsAt: 'midnight UTC',
      });
      return false;
    }
  }

  return true;
}
