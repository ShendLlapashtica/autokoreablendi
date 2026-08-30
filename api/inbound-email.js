// Inbound-email webhook: someone emails you asking for a free key, your mail
// provider POSTs the parsed message here, and this mints a free-tier key and
// emails it straight back. Fully automatic once the env vars below are set.
//
// SAFE BY DEFAULT: with none of the env vars configured this endpoint 401s
// (the shared secret can't match) and can't send mail, so deploying it changes
// nothing until you deliberately turn it on.
//
// Required env vars (set in Vercel):
//   INBOUND_WEBHOOK_SECRET  random string; put it in the provider webhook URL
//                           as ?token=... so only your provider can call this
//   POSTMARK_TOKEN          Postmark Server API token (the outbound reply)
//   MAIL_FROM               a verified sender, e.g. keys@autokoreablendi.com
//   (UPSTASH_REDIS_REST_URL / _TOKEN already exist — used to store the key)
// Optional:
//   INBOUND_REQUIRE_KEYWORD  "0" to reply to every email; default only replies
//                            when the subject/body contains "key"
//
// Built for Postmark's inbound JSON, but the sender/subject parsing tolerates
// Mailgun/SendGrid field names too. Only sendMail() is provider-specific — swap
// it if you use a different provider for the outbound reply.
import { issueFreeKeyForEmail } from '../src/lib/freeKeys.js';

// Pull a bare address out of "Name <a@b.com>" or a plain "a@b.com".
function extractEmail(raw) {
  const s = String(raw || '');
  const angle = s.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : s).trim();
  const m = candidate.match(/[^@\s]+@[^@\s]+\.[^@\s]+/);
  return m ? m[0].toLowerCase() : '';
}

function buildEmailBody(key) {
  return `Hi,

Here's your free API key for AutoKoreaBlendi car data. It gives you your own
quota of 100 requests/day (resets at midnight UTC).

Your key:
  ${key}

How to use it — send it on every request in a header called "x-api-key":

  curl "https://autokoreablendi.com/api/cars?q=bmw%20x5&count=24" \\
    -H "x-api-key: ${key}"

Endpoints (base URL https://autokoreablendi.com):
  GET /api/cars          search & list cars
  GET /api/count         total matches for a filter
  GET /api/car?id=<id>   full detail for one listing

Search params for /api/cars:
  q (free text, e.g. "hyundai tucson") or manufacturer + model,
  fuel, transmission, color, yearFrom, yearTo, mileageFrom, mileageTo,
  priceFrom, priceTo (EUR), sort (priceAsc|priceDesc), page, count (max 500)

Every response includes an X-RateLimit-Remaining header so you can see how much
of your daily 100 is left. Keep this key private — it's tied to you.

Enjoy!`;
}

// Provider-specific outbound. Postmark shown; returns {ok} so the caller can
// report whether the reply actually went out.
async function sendMail(to, subject, text) {
  const token = process.env.POSTMARK_TOKEN;
  const from  = process.env.MAIL_FROM;
  if (!token || !from) return { ok: false, reason: 'mail_not_configured' };
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': token,
      },
      body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, MessageStream: 'outbound' }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, reason: 'send_error' };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Only the mail provider (which knows the secret in its webhook URL) may call
  // this. Unset secret -> sentinel that no real token equals -> always 401.
  const expected = process.env.INBOUND_WEBHOOK_SECRET || '___inbound_unset___';
  if ((req.query.token || '') !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const senderRaw = body?.FromFull?.Email || body.From || body.sender || body.from || '';
  const email     = extractEmail(senderRaw);
  const subject   = String(body.Subject || body.subject || '');
  const text      = String(body.TextBody || body['body-plain'] || body.text || '');

  // Always 200 so the provider doesn't retry — the JSON status is just for logs.
  if (!email) return res.status(200).json({ status: 'ignored', reason: 'no_sender' });

  // Don't auto-reply to unrelated mail (newsletters, bounces) unless disabled.
  if (process.env.INBOUND_REQUIRE_KEYWORD !== '0' &&
      !`${subject} ${text}`.toLowerCase().includes('key')) {
    return res.status(200).json({ status: 'ignored', reason: 'no_keyword' });
  }

  const issued = await issueFreeKeyForEmail(email);
  if (!issued.ok) return res.status(200).json({ status: 'skipped', reason: issued.reason });

  const mail = await sendMail(email, 'Your free AutoKoreaBlendi API key', buildEmailBody(issued.key));
  return res.status(200).json({ status: mail.ok ? 'sent' : 'minted_not_sent', existing: issued.existing });
}
