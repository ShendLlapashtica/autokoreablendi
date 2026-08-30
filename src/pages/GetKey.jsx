import { useState } from 'react';

const CURL_EXAMPLE = (key) =>
  `curl "https://autokoreablendi.com/api/cars?q=bmw%20x5&count=24" \\\n  -H "x-api-key: ${key}"`;

export default function GetKey() {
  const [email, setEmail]     = useState('');
  const [status, setStatus]   = useState('idle'); // idle | loading | done | error
  const [result, setResult]   = useState(null);   // { key, existing }
  const [error, setError]     = useState('');
  const [copied, setCopied]   = useState(false);

  async function submit(e) {
    e.preventDefault();
    setStatus('loading');
    setError('');
    try {
      const res = await fetch('/api/request-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }
      setResult(data);
      setStatus('done');
    } catch {
      setError('Network error. Please try again.');
      setStatus('error');
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(result.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can select manually */ }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="font-display text-3xl font-bold mb-2">Get a free API key</h1>
      <p className="opacity-80 mb-8">
        Free access to live Korean car listings. Each key gives you your own quota of
        <strong> 100 requests/day</strong>. Enter your email and your key appears instantly.
      </p>

      {status !== 'done' && (
        <form onSubmit={submit} className="bg-card border border-black/10 rounded-xl p-6">
          <label htmlFor="email" className="block text-sm font-medium mb-2">Email address</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-lg border border-black/15 bg-surface px-4 py-3 outline-none focus:border-accent"
          />
          {status === 'error' && (
            <p className="text-accent text-sm mt-3">{error}</p>
          )}
          <button
            type="submit"
            disabled={status === 'loading'}
            className="mt-4 w-full rounded-lg bg-accent hover:bg-accent-dark text-white font-semibold py-3 transition-colors disabled:opacity-60"
          >
            {status === 'loading' ? 'Generating…' : 'Get my key'}
          </button>
        </form>
      )}

      {status === 'done' && result && (
        <div className="bg-card border border-black/10 rounded-xl p-6">
          <p className="font-medium mb-3">
            {result.existing
              ? 'You already have a key — here it is again:'
              : 'Your key is ready:'}
          </p>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 break-all rounded-lg bg-surface border border-black/15 px-4 py-3 text-sm">
              {result.key}
            </code>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-lg bg-accent hover:bg-accent-dark text-white px-4 text-sm font-semibold transition-colors"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <h2 className="font-display text-lg font-semibold mt-8 mb-2">How to use it</h2>
          <p className="opacity-80 text-sm mb-3">
            Send your key on every request in an <code>x-api-key</code> header:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-graphite text-white text-xs p-4 leading-relaxed">
{CURL_EXAMPLE(result.key)}
          </pre>

          <div className="text-sm opacity-80 mt-6 space-y-1">
            <p><strong>Endpoints</strong> (base <code>https://autokoreablendi.com</code>):</p>
            <p className="pl-3"><code>GET /api/cars</code> — search &amp; list cars</p>
            <p className="pl-3"><code>GET /api/count</code> — total matches for a filter</p>
            <p className="pl-3"><code>GET /api/car?id=&lt;id&gt;</code> — one listing’s full detail</p>
            <p className="mt-3">
              Limit: 100 requests/day (resets midnight UTC). Every response includes an
              <code> X-RateLimit-Remaining</code> header. Keep your key private.
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
