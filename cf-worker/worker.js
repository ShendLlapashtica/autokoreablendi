// Minimal relay so api/cars.js has a fallback data path that isn't Vercel's
// egress IPs (which Encar's direct API already rejects) and isn't one of
// the free public CORS proxies (allorigins/corsproxy/codetabs — all down or
// blocking at once as of 2026-08-20). Cloudflare's network is a different
// IP range entirely, so it's worth a shot as a 5th attempt.
//
// No auth secret — kept intentionally zero-setup. Safety instead comes from
// a hard allowlist: this can only ever relay to api.encar.com, which is
// itself a public, unauthenticated, read-only search API, so the worst case
// of someone else finding this URL is them also querying data Encar already
// serves to anyone, just spending this account's free request quota.
const ALLOWED_HOSTS = ['api.encar.com', 'www.encar.com'];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url param' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      });
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid url param' }), {
        status: 400,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      });
    }

    if (!ALLOWED_HOSTS.includes(targetUrl.hostname)) {
      return new Response(JSON.stringify({ error: `Host not allowed: ${targetUrl.hostname}` }), {
        status: 403,
        headers: { 'content-type': 'application/json', ...CORS_HEADERS },
      });
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'Referer': 'https://www.encar.com/',
        'Origin': 'https://www.encar.com',
      },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...CORS_HEADERS },
    });
  },
};
