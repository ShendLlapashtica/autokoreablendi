import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { carPhotoUrl, allPhotoUrls, fmtEur, fmtKm, carYear, tr, trCity } from '../lib/utils.js';
import { translateFuel, translateTrans, translateColor } from '../lib/translations.js';
import { useCountry } from '../contexts/CountryContext.jsx';
import { getBrandLogo } from '../lib/logos.js';

const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='260'%3E%3Crect width='400' height='260' fill='%23F8F9FA'/%3E%3Ctext x='200' y='138' text-anchor='middle' fill='%23C4C4CA' font-size='13' font-family='sans-serif'%3EFoto nuk disponohet%3C/text%3E%3C/svg%3E";

const CONDITION_ALB = { Inspection: 'Inspektuar', InspectionDirect: 'Inspektim Direkt', Record: 'Histori', Resume: 'Raport', Warranty: 'Garanci' };

// Encar's own security/insurance/verification badges (Trust + ServiceMark
// fields), translated to Albanian and shown alongside the condition badges.
const SECURITY_ALB = {
  ExtendWarranty:    'Garanci e Zgjatur',
  HomeService:       'Verifikim në Vend',
  Meetgo:            'Takim i Verifikuar',
  EncarMeetgo:       'Takim i Verifikuar',
  EncarDiagnosisP0:  'Diagnostikim i Certifikuar',
  EncarDiagnosisP1:  'Diagnostikim i Certifikuar',
  EncarDiagnosisP2:  'Diagnostikim i Certifikuar',
};

// Per-tab photo cache keyed by car Id — a hovered card's full gallery is
// fetched once and reused if the same card is hovered again.
const photoCache = new Map();

const FUEL_COLOR = {
  'Elektrik': 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  'Hibrid':   'bg-teal-500/15 text-teal-300 border-teal-500/25',
  'Naftë':    'bg-amber-500/15 text-amber-300 border-amber-500/25',
  'default':  'bg-red-500/15 text-red-300 border-red-500/25',
};

export default function CarCard({ car }) {
  const basePhotos = useMemo(() => {
    const urls = allPhotoUrls(car);
    return urls.length > 0 ? urls : (carPhotoUrl(car) ? [carPhotoUrl(car)] : []);
  }, [car]);
  const [fullPhotos, setFullPhotos] = useState(() => photoCache.get(car.Id) || null);
  const photos = fullPhotos && fullPhotos.length > basePhotos.length ? fullPhotos : basePhotos;

  const [activeIdx, setActiveIdx] = useState(0);
  const [broken, setBroken] = useState(() => new Set());
  const [logoBroken, setLogoBroken] = useState(false);
  const fetchingRef = useRef(false);
  const { priceFor, label } = useCountry();

  // Keep each surviving photo paired with its original index so a broken
  // image can be marked (and skipped) without losing track of which one it was.
  const visible = photos.map((url, i) => ({ url, i })).filter(p => !broken.has(p.i));
  const current = visible.length > 0 ? visible[Math.min(activeIdx, visible.length - 1)] : null;
  const shown   = current ? current.url : PLACEHOLDER;

  function scrub(e) {
    if (visible.length <= 1) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setActiveIdx(Math.min(visible.length - 1, Math.max(0, Math.floor(ratio * visible.length))));
  }

  // Search-result listings only carry a handful of photos; fetch the car's
  // full detail once on first hover to unlock its whole gallery for scrubbing.
  function loadFullGallery() {
    if (fetchingRef.current || photoCache.has(car.Id)) return;
    fetchingRef.current = true;
    fetch(`/api/car?id=${car.Id}`)
      .then(r => r.json())
      .then(data => {
        const urls = allPhotoUrls(data);
        photoCache.set(car.Id, urls);
        if (urls.length > basePhotos.length) setFullPhotos(urls);
      })
      .catch(() => {});
  }

  const year   = carYear(car);
  const price  = priceFor(car.Price);
  const fuel   = translateFuel(car.FuelType);
  const trans  = translateTrans(car.Transmission);
  const color  = translateColor(car.Color);
  const maker  = tr(car.Manufacturer);
  const model  = tr(car.Model);
  const badge  = tr(car.Badge);
  const badgeDetail = tr(car.BadgeDetail);
  const cc     = car.CylinderCapacity || car.Spec?.Displacement;
  const drive  = car.Spec?.Drive || car.Drive;
  const city   = trCity(car.OfficeCityState);
  const fuelCls = FUEL_COLOR[fuel] || FUEL_COLOR.default;
  const conditions = (car.Condition || []).slice(0, 3);
  const securityBadges = [...new Set(
    [...(car.Trust || []), ...(car.ServiceMark || [])].map(v => SECURITY_ALB[v]).filter(Boolean)
  )].slice(0, 2);

  return (
    <Link
      to={`/car/${car.Id}`}
      state={{ car }}
      className="group flex flex-col rounded-lg overflow-hidden transition-all duration-200 hover:-translate-y-0.5 glass-card"
      style={{ boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderColor: 'var(--border)' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(181,9,9,0.35)'; e.currentTarget.style.boxShadow = '0 12px 28px rgba(181,9,9,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.05)'; }}
    >
      {/* Photo — hover-scrub through every available angle, like Airbnb/Zillow cards */}
      <div
        className="relative overflow-hidden flex-shrink-0"
        style={{ aspectRatio: '16/10', background: 'var(--bg-card2)' }}
        onMouseEnter={loadFullGallery}
        onMouseMove={scrub}
        onMouseLeave={() => setActiveIdx(0)}
      >
        <img
          src={shown}
          alt={`${maker} ${model}`}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
          onError={() => {
            if (current) setBroken(prev => new Set(prev).add(current.i));
          }}
        />
        {visible.length > 1 && (
          visible.length > 8 ? (
            <span className="absolute top-2 right-2 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-white">
              {activeIdx + 1}/{visible.length}
            </span>
          ) : (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 flex gap-1">
              {visible.map((p, i) => (
                <span
                  key={p.i}
                  className="rounded-full transition-all"
                  style={{
                    width: i === activeIdx ? '14px' : '4px',
                    height: '4px',
                    background: i === activeIdx ? '#fff' : 'rgba(255,255,255,0.5)',
                    boxShadow: '0 0 2px rgba(0,0,0,0.5)',
                  }}
                />
              ))}
            </div>
          )
        )}
        {(conditions.length > 0 || securityBadges.length > 0) && (
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-1rem)]">
            {conditions.map(c => (
              <span key={c} className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-white/70 border border-white/10">
                {CONDITION_ALB[c] || c}
              </span>
            ))}
            {securityBadges.map(label => (
              <span key={label} className="flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded bg-black/60 backdrop-blur text-emerald-300 border border-emerald-400/20">
                🛡 {label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Name */}
        <div>
          <div className="flex items-center gap-2">
            {(() => {
              const logoUrl = getBrandLogo(maker);
              return logoUrl && !logoBroken ? (
                <img
                  src={logoUrl}
                  alt={maker}
                  className="flex-shrink-0 w-7 h-7 rounded-full object-contain bg-white border"
                  style={{ borderColor: 'var(--border)' }}
                  onError={() => setLogoBroken(true)}
                />
              ) : null;
            })()}
            <h3 className="text-base font-bold leading-snug" style={{ color: 'var(--text-1)' }}>
              {maker} <span style={{ color: 'var(--text-2)' }}>{model}</span>
            </h3>
          </div>
          {badge && (
            <p className="text-xs mt-0.5 leading-snug truncate" style={{ color: 'var(--text-3)' }}>
              {[badge, badgeDetail].filter(Boolean).join(' · ')}
            </p>
          )}
          {(year || fuel) && (
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {year && (
                <span className="font-mono text-[11px] font-bold" style={{ color: 'var(--text-1)' }}>{year}</span>
              )}
              {year && fuel && <span style={{ color: 'var(--text-4)' }}>·</span>}
              {fuel && (
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${fuelCls}`}>{fuel}</span>
              )}
            </div>
          )}
        </div>

        {/* Attribute grid */}
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          {car.Mileage != null && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span className="text-red-500/70">km</span>
              <span className="font-mono font-semibold truncate" style={{ color: 'var(--text-1)' }}>{fmtKm(car.Mileage)}</span>
            </div>
          )}
          {trans && trans !== '—' && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span className="text-red-500/70">⚙</span>
              <span className="truncate">{trans}</span>
            </div>
          )}
          {cc && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span className="text-red-500/70">cc</span>
              <span className="font-mono truncate" style={{ color: 'var(--text-1)' }}>{Number(cc).toLocaleString('de-DE')}</span>
            </div>
          )}
          {drive && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span className="text-red-500/70">↕</span>
              <span className="truncate">{drive}</span>
            </div>
          )}
          {color && color !== '—' && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span className="text-red-500/70">◐</span>
              <span className="truncate">{color}</span>
            </div>
          )}
          {city && (
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1" style={{ background: 'var(--bg-input)', color: 'var(--text-2)' }}>
              <span>🇰🇷</span>
              <span className="truncate">{city}</span>
            </div>
          )}
        </div>

        <div style={{ background: 'linear-gradient(90deg, transparent, rgba(181,9,9,0.3), transparent)', height: '1px' }} />

        {/* Price */}
        <div className="flex items-end justify-between mt-auto">
          <div>
            <p className="font-mono text-2xl font-extrabold tracking-tight leading-none text-red-500">
              {price > 0 ? fmtEur(price) : '—'}
            </p>
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-3)' }}>{label}</p>
          </div>
          <span className="flex items-center gap-1 text-xs font-bold text-white px-3 py-2 rounded-lg bg-red-600 group-hover:bg-red-500 transition-colors">
            SHIKO →
          </span>
        </div>
      </div>
    </Link>
  );
}
