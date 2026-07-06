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
          background: 'linear-gradient(145deg, #FFFFFF 0%, #F8F9FA 50%, #FFFFFF 100%)',
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
          background: 'radial-gradient(circle, rgba(220,38,38,0.12) 0%, transparent 70%)',
          display: 'flex',
        }} />
        <div style={{
          position: 'absolute', bottom: '-100px', left: '200px',
          width: '400px', height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(220,38,38,0.08) 0%, transparent 70%)',
          display: 'flex',
        }} />

        {/* Top: the actual logo */}
        <div style={{ display: 'flex' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://auto-korea-partner.vercel.app/logo.png"
            width="360"
            height="165"
            alt="Auto Korea Partner"
          />
        </div>

        {/* Middle: Main value prop */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ fontSize: '44px', fontWeight: 800, color: '#1A1A1A', lineHeight: 1.15, letterSpacing: '-0.5px' }}>
            Makina Koreane
          </div>
          <div style={{ fontSize: '44px', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.5px', display: 'flex', gap: '12px' }}>
            <span style={{ color: '#1A1A1A' }}>për</span>
            <span style={{ color: '#DC2626' }}>Shqipëri</span>
            <span style={{ color: '#8A8A93' }}>&</span>
            <span style={{ color: '#DC2626' }}>Kosovë</span>
          </div>
          <div style={{ fontSize: '22px', color: '#52525B', marginTop: '4px', fontWeight: 400 }}>
            🇰🇷 → 🇦🇱 🇽🇰  ·  Çmim all-in · Inspektim Encar · Dorëzim 30–45 ditë
          </div>
        </div>

        {/* Bottom: Stats */}
        <div style={{ display: 'flex', gap: '48px', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '42px', fontWeight: 900, color: '#1A1A1A', letterSpacing: '-1px' }}>200,000+</span>
            <span style={{ fontSize: '16px', color: '#52525B', fontWeight: 500 }}>listëzime live · drejtpërdrejt nga Encar</span>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
            <span style={{ fontSize: '18px', color: '#52525B', fontWeight: 600 }}>auto-korea-partner.vercel.app</span>
            <span style={{ fontSize: '14px', color: '#8A8A93', fontWeight: 400 }}>+383 48 407 634</span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
