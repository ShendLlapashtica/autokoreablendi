import { ImageResponse } from '@vercel/og';
import React from 'react';

export const config = { runtime: 'edge' };

const h = React.createElement;

// Runs as an isolated Vercel edge function, separate from the SPA bundle —
// intentionally not importing src/lib/brand.js so this stays self-contained.
const BRAND_NAME  = 'Auto Korea Blendi';
const SITE_URL    = 'autokoreablendi.com';
const LOGO_URL    = 'https://autokoreablendi.com/logo.png';
const PHONE_DISP  = '+383 44 555 630';

export default function handler() {
  return new ImageResponse(
    h(
      'div',
      {
        style: {
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
        },
      },
      // Background glow circles
      h('div', {
        style: {
          position: 'absolute', top: '-120px', right: '-80px',
          width: '500px', height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(181,9,9,0.12) 0%, transparent 70%)',
          display: 'flex',
        },
      }),
      h('div', {
        style: {
          position: 'absolute', bottom: '-100px', left: '200px',
          width: '400px', height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(181,9,9,0.08) 0%, transparent 70%)',
          display: 'flex',
        },
      }),
      // Top: the actual logo
      h('div', { style: { display: 'flex' } },
        h('img', { src: LOGO_URL, width: 549, height: 165, alt: BRAND_NAME })
      ),
      // Middle: Main value prop
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', { style: { fontSize: '44px', fontWeight: 800, color: '#1A1A1A', lineHeight: 1.15, letterSpacing: '-0.5px' } }, 'Makina Koreane'),
        h('div', { style: { fontSize: '44px', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.5px', display: 'flex', gap: '12px' } },
          h('span', { style: { color: '#1A1A1A' } }, 'për'),
          h('span', { style: { color: '#B50909' } }, 'Shqipëri'),
          h('span', { style: { color: '#8A8A93' } }, '&'),
          h('span', { style: { color: '#B50909' } }, 'Kosovë'),
        ),
        h('div', { style: { fontSize: '22px', color: '#52525B', marginTop: '4px', fontWeight: 400 } },
          '🇰🇷 → 🇦🇱 🇽🇰  ·  Çmim all-in · Inspektim Encar · Dorëzim 30–45 ditë'
        ),
      ),
      // Bottom: Stats
      h('div', { style: { display: 'flex', gap: '48px', alignItems: 'flex-end' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('span', { style: { fontSize: '42px', fontWeight: 900, color: '#1A1A1A', letterSpacing: '-1px' } }, '200,000+'),
          h('span', { style: { fontSize: '16px', color: '#52525B', fontWeight: 500 } }, 'listëzime live · drejtpërdrejt nga Encar'),
        ),
        h('div', { style: { marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } },
          h('span', { style: { fontSize: '18px', color: '#52525B', fontWeight: 600 } }, SITE_URL),
          h('span', { style: { fontSize: '14px', color: '#8A8A93', fontWeight: 400 } }, PHONE_DISP),
        ),
      ),
    ),
    { width: 1200, height: 630 }
  );
}
