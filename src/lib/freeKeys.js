// Dynamically-issued free-tier keys, stored in Upstash Redis so a new key is
// valid the instant it's written — no env-var edit, no redeploy. This is what
// makes self-serve / auto-reply key issuance possible; the static env-var keys
// in rateLimit.js (FRIEND_API_KEYS) can't be added to without a redeploy.
//
// Redis layout:
//   autovg:freekey:valid:<key>       -> JSON {email, createdAt}  (existence = valid)
//   autovg:freekey:byemail:<email>   -> <key>  (idempotency: one key per email)
//   autovg:freekey:issued:<YYYYMMDD> -> counter (daily issuance cap, abuse bound)
import { randomBytes } from 'crypto';

// How many brand-new keys may be minted per day across all requesters. A
// re-request from an email that already has a key does NOT count (it returns
// the existing key), so this only bounds genuinely new issuance. Tunable via
// env without a code change.
const DAILY_ISSUE_CAP = parseInt(process.env.FREEKEY_DAILY_CAP || '50', 10);

function generateFreeKey() {
  return 'avg_free_' + randomBytes(24).toString('base64url').slice(0, 32);
}

// Robust to both Upstash REST response shapes: pipeline elements come back
// either as [error, result] or as { result } depending on account/version.
function readResult(item) {
  if (Array.isArray(item)) return item[1];
  if (item && typeof item === 'object') return item.result;
  return item;
}

async function pipe(cmds) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null; // Redis not configured
  try {
    const res = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmds),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.map(readResult) : null;
  } catch {
    return null;
  }
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Issue (or re-return) a free-tier key for an email address.
 * Idempotent: the same email always gets the same key back, so a person
 * emailing twice never burns the daily cap or accumulates keys.
 *
 * Returns:
 *   { ok: true,  key, existing }          key is valid and live
 *   { ok: false, reason }                 'invalid_email' | 'cap_reached' | 'no_store'
 */
export async function issueFreeKeyForEmail(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return { ok: false, reason: 'invalid_email' };

  // Redis is mandatory here — without it a key can't be persisted or validated,
  // so fail loudly rather than hand out a key that won't work.
  const existingArr = await pipe([['GET', `autovg:freekey:byemail:${email}`]]);
  if (existingArr === null) return { ok: false, reason: 'no_store' };
  const existing = existingArr[0];
  if (existing) return { ok: true, key: existing, existing: true };

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const capKey = `autovg:freekey:issued:${today}`;
  const incr = await pipe([['INCR', capKey], ['EXPIRE', capKey, 172800]]);
  const count = incr ? incr[0] : null;
  if (count != null && count > DAILY_ISSUE_CAP) return { ok: false, reason: 'cap_reached' };

  const key  = generateFreeKey();
  const meta = JSON.stringify({ email, createdAt: Date.now() });
  await pipe([
    ['SET', `autovg:freekey:valid:${key}`, meta],
    ['SET', `autovg:freekey:byemail:${email}`, key],
  ]);
  return { ok: true, key, existing: false };
}

/**
 * Validate a presented key against the dynamic (Redis) store.
 * Returns a quota label (the owner's email) if valid, else null.
 * Used by rateLimit.js after the static env-var keys don't match.
 */
export async function freeKeyLabel(key) {
  if (!key) return null;
  const arr = await pipe([['GET', `autovg:freekey:valid:${key}`]]);
  if (!arr || !arr[0]) return null;
  try { return JSON.parse(arr[0]).email || 'freekey'; }
  catch { return 'freekey'; }
}
