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

import { ProxyAgent, fetch as undiciFetch } from 'undici';

const PROXY_URL = (process.env.ENCAR_PROXY_URL || '').trim();
export const proxyConfigured = PROXY_URL.length > 0;

let agent = null;

/** fetch() through the residential proxy. */
export function proxyFetch(url, init = {}) {
  agent ??= new ProxyAgent(PROXY_URL);
  return undiciFetch(url, { ...init, dispatcher: agent });
}

const HEDGE_MS = 2500;

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
