// A residential proxy as a second, independent route to Encar.
//
// Encar blocks datacenter egress (Vercel, AWS, Cloudflare; the Deno relay was
// blocked once, 2026-09-14). The relay is the main route; this proxy is the
// one that does not share its fate. It is hedged, not raced: it starts only
// when the other routes have failed, or have not answered within HEDGE_MS --
// so in normal operation it carries no traffic and costs nothing (residential
// proxies bill per GB).
//
// Off unless ENCAR_PROXY_URL is set, e.g. http://user:pass@host:port (any
// HTTP proxy that supports CONNECT -- what residential providers hand out).
// ENCAR_PROXY_URL_2 optionally adds a second provider; tries alternate
// between them, so one provider's outage or empty balance is not fatal.

import { ProxyAgent, fetch as undiciFetch } from 'undici';

const PROXY_URLS = [process.env.ENCAR_PROXY_URL, process.env.ENCAR_PROXY_URL_2]
  .map(u => (u || '').trim())
  .filter(Boolean);
export const proxyConfigured = PROXY_URLS.length > 0;

const TRIES       = 3;
const PER_TRY_MS  = 3000;
const agents      = new Map();

/**
 * fetch() through the residential proxy, retried.
 *
 * Since 2026-10-03 the proxy is the only route that reaches Encar (direct is
 * blocked, the Deno relay is suspended), so one bad exit IP must not fail a
 * request. A retry gets a fresh connection -- and with rotating residential
 * proxies, a fresh IP -- and each try is capped so a hung exit cannot eat the
 * whole deadline. 403/429/5xx are retried; other statuses are real answers.
 */
export async function proxyFetch(url, init = {}) {
  let lastErr;
  for (let i = 0; i < TRIES; i++) {
    if (init.signal?.aborted) break;
    const proxyUrl = PROXY_URLS[i % PROXY_URLS.length];
    // First try reuses the pooled connection; retries open a new one.
    let agent = agents.get(proxyUrl);
    if (!agent || i >= PROXY_URLS.length) {
      agent = new ProxyAgent(proxyUrl);
      agents.set(proxyUrl, agent);
    }
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(PER_TRY_MS)])
      : AbortSignal.timeout(PER_TRY_MS);
    try {
      const r = await undiciFetch(url, { ...init, signal, dispatcher: agent });
      if (r.status !== 403 && r.status !== 429 && r.status < 500) return r;
      lastErr = new Error(`proxy HTTP ${r.status}`);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('proxy: aborted');
}

const HEDGE_MS = 300;

/**
 * Resolves with the first of `primary` (a promise) or, when that has failed
 * or is still pending after HEDGE_MS, `viaProxy()` -- whichever succeeds
 * first. Without a configured proxy it is just `primary`.
 */
export function withProxyFallback(primary, viaProxy) {
  if (!proxyConfigured) return primary;
  return new Promise((resolve, reject) => {
    let settled = false, proxyStarted = false, primaryFailed = null, proxyFailed = null;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const startProxy = () => {
      if (proxyStarted) return;
      proxyStarted = true;
      viaProxy().then(v => done(resolve, v), err => {
        proxyFailed = err;
        if (primaryFailed) done(reject, new AggregateError([primaryFailed, err], 'all routes failed'));
      });
    };
    const timer = setTimeout(startProxy, HEDGE_MS);
    primary.then(v => done(resolve, v), err => {
      primaryFailed = err;
      if (proxyFailed) done(reject, new AggregateError([err, proxyFailed], 'all routes failed'));
      else startProxy();
    });
  });
}
