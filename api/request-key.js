// Self-serve free-key issuance: POST { email } -> a live free-tier key.
// Backs the /get-key page. Needs no mail provider and no new env vars — it
// reuses the Redis layer in freeKeys.js and the Upstash vars already set.
import { issueFreeKeyForEmail } from '../src/lib/freeKeys.js';

// Bounds how many times one IP can hit the form per hour, so the daily
// issuance cap can't be drained by a script submitting many addresses.
const IP_HOURLY_LIMIT = 5;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

async function ipUnderLimit(ip) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return true; // no store -> don't block
  const bucket = Math.floor(Date.now() / 3600000);
  const k = `autovg:reqkey:ip:${ip}:${bucket}`;
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', k], ['EXPIRE', k, 3600]]),
    });
    if (!res.ok) return true;
    const data = await res.json();
    const item = Array.isArray(data) ? data[0] : null;
    const count = Array.isArray(item) ? item[1] : item?.result;
    return count == null || count <= IP_HOURLY_LIMIT;
  } catch {
    return true;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const email = (body?.email || '').toString().trim();
  if (!email) return res.status(400).json({ error: 'Email required.' });

  if (!(await ipUnderLimit(clientIp(req)))) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  const issued = await issueFreeKeyForEmail(email);
  if (!issued.ok) {
    const map = {
      invalid_email: [400, 'Please enter a valid email address.'],
      cap_reached:   [429, "Today's free-key limit was reached. Please try again tomorrow."],
      no_store:      [503, 'Key service is temporarily unavailable. Please try again shortly.'],
    };
    const [code, error] = map[issued.reason] || [500, 'Could not issue a key.'];
    return res.status(code).json({ error });
  }

  return res.status(200).json({ key: issued.key, existing: issued.existing });
}
