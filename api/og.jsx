import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default function handler() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(145deg, #060612 0%, #0a0a1f 50%, #060a1c 100%)',
          padding: '64px',
          fontFamily: 'sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Background glow circles */}
        <div style={{
          position: 'absolute', top: '-120px', right: '-80px',
          width: '500px', height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(220,38,38,0.14) 0%, transparent 70%)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: '-100px', left: '200px',
          width: '400px', height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(220,38,38,0.08) 0%, transparent 70%)',
          display: 'flex',
        }} />

        {/* Top: Logo + tagline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
            <span style={{ fontSize: '80px', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-2px', fontFamily: 'monospace' }}>
              AUTO
            </span>
            <span style={{ fontSize: '80px', fontWeight: 900, color: '#dc2626', letterSpacing: '-2px', fontFamily: 'monospace' }}>
              VG
            </span>
          </div>

          {/* Accent line */}
          <div style={{
            width: '80px', height: '3px', borderRadius: '2px',
            background: 'linear-gradient(90deg, #ef4444, #991b1b)',
            display: 'flex',
          }} />
        </div>

        {/* Middle: Main value prop */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '44px', fontWeight: 800, color: '#f1f5f9', lineHeight: 1.15, letterSpacing: '-0.5px' }}>
            Makina Koreane
          </div>
          <div style={{ fontSize: '44px', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.5px', display: 'flex', gap: '12px' }}>
            <span style={{ color: '#f1f5f9' }}>për</span>
            <span style={{ color: '#dc2626' }}>Shqipëri</span>
            <span style={{ color: '#94a3b8' }}>&</span>
            <span style={{ color: '#ef4444' }}>Kosovë</span>
          </div>
          <div style={{ fontSize: '22px', color: '#475569', marginTop: '4px', fontWeight: 400 }}>
            🇰🇷 → 🇦🇱 🇽🇰  ·  Çmim all-in · Inspektim Encar · Dorëzim 30–45 ditë
          </div>
        </div>

        {/* Bottom: Stats */}
        <div style={{ display: 'flex', gap: '48px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '42px', fontWeight: 900, color: '#f1f5f9', letterSpacing: '-1px', fontFamily: 'monospace' }}>200,000+</span>
            <span style={{ fontSize: '16px', color: '#475569', fontWeight: 500 }}>listëzime live · drejtpërdrejt nga Encar</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span style={{ fontSize: '18px', color: '#334155', fontWeight: 600 }}>auto-vg.vercel.app</span>
            <span style={{ fontSize: '14px', color: '#5f1616', fontWeight: 400 }}>+383 48 407 634</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
