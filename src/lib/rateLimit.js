// API key gate + rate limiting (100 req/day per key)
// Uses Upstash Redis REST API directly — no npm package needed
// Gracefully degrades: if env vars not set, just validates the key (no count enforcement)
//
// Supports handing out more than one free key, each with its own independent
// daily quota (so person A spamming never eats into person B's 100/day):
//   FRIEND_API_KEY   = single legacy key, counted under the "friend" label
//   FRIEND_API_KEYS  = "label1:key1,label2:key2,..." for additional people
// Revoke one person by deleting their entry — the others are unaffected.

import { timingSafeEqual } from 'crypto';

const DAILY_LIMIT = 100;

function loadKeys() {
  const keys = new Map(); // key value -> label
  if (process.env.FRIEND_API_KEY) keys.set(process.env.FRIEND_API_KEY, 'friend');
  for (const pair of (process.env.FRIEND_API_KEYS || '').split(',')) {
    const [label, value] = pair.split(':').map(s => s?.trim());
    if (label && value) keys.set(value, label);
  }
  return keys;
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

async function redisIncr(key) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Redis not configured — skip counting

  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['INCR', key],
        ['EXPIRE', key, 86400],
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
 * Normal website traffic (no x-api-key header) always passes through.
 */
export async function checkApiKey(req, res) {
  const key = (req.headers['x-api-key'] || '').trim();

  // No key = normal website visitor → always allow
  if (!key) return true;

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
