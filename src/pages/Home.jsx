import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { X, SlidersHorizontal, Search } from 'lucide-react';
import CarCard from '../components/CarCard.jsx';
import Filters from '../components/Filters.jsx';
import { waLink } from '../lib/brand.js';
import { TRUST_CHECKLIST, INFO_BLOCKS } from '../lib/trustContent.js';
import { BRANDS } from '../lib/brandModels.js';
import { getBrandLogo } from '../lib/logos.js';
import { parseSearchQuery } from '../lib/search.js';

function MarqueeItem({ brand }) {
  const [broken, setBroken] = useState(false);
  const logoUrl = getBrandLogo(brand);

  if (logoUrl && !broken) {
    return (
      <img
        src={logoUrl}
        alt={brand}
        title={brand}
        className="flex-shrink-0 h-6 w-auto object-contain grayscale opacity-70 hover:opacity-100 hover:grayscale-0 transition-all"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <span className="flex-shrink-0 font-display text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>
      {brand}
    </span>
  );
}

const PAGE_SIZE = 24;
// Default listing order is Encar's own "most recent" feed — price sorting
// (low→high or high→low) is opt-in via the Rendit dropdown, not the default.
const DEFAULT_SORT = '';
const EMPTY_FILTERS = {
  manufacturer: '', model: '', fuel: '', transmission: '', color: '',
  yearFrom: '', yearTo: '', mileageTo: '', priceFrom: '', priceTo: '',
  sort: DEFAULT_SORT,
};

function filtersFromParams(params) {
  return {
    manufacturer: params.get('brand')    || '',
    model:        params.get('model')    || '',
    fuel:         params.get('fuel')     || '',
    transmission: params.get('transmission') || '',
    color:        params.get('color')    || '',
    yearFrom:     params.get('yearFrom') || '',
    yearTo:       params.get('yearTo')   || '',
    mileageTo:    params.get('kmMax')    || '',
    priceFrom:    params.get('priceFrom') || '',
    priceTo:      params.get('priceTo')   || '',
    sort:         params.get('sort')     || DEFAULT_SORT,
  };
}

function paramsFromFilters(f, keyword) {
  const p = {};
  if (keyword)      p.q       = keyword;
  if (f.manufacturer) p.brand   = f.manufacturer;
  if (f.model)        p.model   = f.model;
  if (f.fuel)         p.fuel    = f.fuel;
  if (f.transmission) p.transmission = f.transmission;
  if (f.color)        p.color   = f.color;
  if (f.yearFrom)     p.yearFrom = f.yearFrom;
  if (f.yearTo)       p.yearTo   = f.yearTo;
  if (f.mileageTo)    p.kmMax    = f.mileageTo;
  if (f.priceFrom)    p.priceFrom = f.priceFrom;
  if (f.priceTo)      p.priceTo   = f.priceTo;
  if (f.sort)         p.sort     = f.sort;
  return p;
}

export default function Home() {
  const [searchParams, setSearchParams] = useSearchParams();
  const keyword = searchParams.get('q') || '';

  const [cars, setCars]       = useState([]);
  const [total, setTotal]     = useState(null);
  const [page, setPage]       = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState(null);
  const [filters, setFilters] = useState(() => filtersFromParams(searchParams));
  const [heroSearch, setHeroSearch] = useState(keyword);

  // Sticky filter button state
  const [filtersVisible, setFiltersVisible]     = useState(true);
  const [filterForceOpen, setFilterForceOpen]   = useState(false);
  const filtersWrapRef = useRef(null);

  const session    = useRef(0);
  const sentinel   = useRef(null);
  const loadingRef = useRef(false);
  const doneRef    = useRef(false);

  // Sync URL → filters when searchParams change externally (e.g. from Header search)
  useEffect(() => {
    setFilters(filtersFromParams(searchParams));
  }, [searchParams]);

  // Keep the hero search box in sync with the URL keyword (e.g. cleared via the X button)
  useEffect(() => {
    setHeroSearch(keyword);
  }, [keyword]);

  function handleHeroSearch(e) {
    e.preventDefault();
    const q = heroSearch.trim();
    if (!q) return;
    const parsed = parseSearchQuery(q);
    if (Object.keys(parsed).length > 0) {
      setSearchParams(parsed, { replace: false });
    } else {
      setSearchParams({ q }, { replace: false });
    }
  }

  // Watch when filter row scrolls out of view → show desktop floating button
  useEffect(() => {
    const el = filtersWrapRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setFiltersVisible(entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  function handleFilterChange(updater) {
    setFilters(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      setSearchParams(paramsFromFilters(next, keyword), { replace: true });
      return next;
    });
  }

  function clearSearch() {
    setSearchParams(paramsFromFilters(filters, ''), { replace: true });
  }

  const loadPage = useCallback(async (pg, flt, kw, replace) => {
    const sid = ++session.current;
    loadingRef.current = true;
    setLoading(true);
    if (replace) { setCars([]); setDone(false); doneRef.current = false; }
    setError(null);

    try {
      const params = new URLSearchParams({ page: pg, count: PAGE_SIZE });
      if (kw) {
        params.set('q', kw);
      } else {
        if (flt.manufacturer) params.set('manufacturer', flt.manufacturer);
        if (flt.model)        params.set('model', flt.model);
      }
      if (flt.fuel)         params.set('fuel', flt.fuel);
      if (flt.transmission) params.set('transmission', flt.transmission);
      if (flt.color)        params.set('color', flt.color);
      if (flt.yearFrom)  params.set('yearFrom', flt.yearFrom);
      if (flt.yearTo)    params.set('yearTo', flt.yearTo);
      if (flt.mileageTo) params.set('mileageTo', flt.mileageTo);
      if (flt.priceFrom) params.set('priceFrom', flt.priceFrom);
      if (flt.priceTo)   params.set('priceTo', flt.priceTo);
      if (flt.sort)      params.set('sort', flt.sort);

      const r    = await fetch(`/api/cars?${params}`);
      const data = await r.json();
      if (sid !== session.current) return;
      if (data.error) throw new Error(data.error);

      const newCars = data.results || data.SearchResults || [];
      const tot     = data.total ?? data.Count ?? 0;

      setCars(prev => {
        const next = replace ? newCars : [...prev, ...newCars];
        const isDone = next.length >= tot || newCars.length < PAGE_SIZE;
        if (isDone) { setDone(true); doneRef.current = true; }
        return next;
      });
      setTotal(tot);
    } catch (e) {
      if (sid !== session.current) return;
      setError(e.message);
    } finally {
      if (sid === session.current) { loadingRef.current = false; setLoading(false); }
    }
  }, []);

  // Reset on filter/keyword change
  useEffect(() => {
    setPage(0);
    loadPage(0, filters, keyword, true);
  }, [filters, keyword, loadPage]);

  // Infinite scroll — stable observer, refs avoid stale-closure issues
  const filtersRef = useRef(filters);
  const keywordRef = useRef(keyword);
  useEffect(() => { filtersRef.current = filters; }, [filters]);
  useEffect(() => { keywordRef.current = keyword; }, [keyword]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingRef.current && !doneRef.current) {
          setPage(prev => {
            const next = prev + 1;
            loadPage(next, filtersRef.current, keywordRef.current, false);
            return next;
          });
        }
      },
      { rootMargin: '600px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadPage]); // stable — never disconnects/reconnects due to loading/done changes

  const isSearching = !!keyword;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-page)' }}>

      {/* Hero — BMW image with dark gradient overlay */}
      <div className="relative overflow-hidden" style={{ minHeight: isSearching ? '220px' : '440px' }}>
        <img src="/hero-bmw.png" alt=""
             className="absolute inset-0 w-full h-full object-cover" style={{ objectPosition: 'center 25%' }} />
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(180deg, rgba(5,5,12,0.35) 0%, rgba(5,5,12,0.55) 45%, var(--bg-page-solid) 100%)',
        }} />

        <div className="relative max-w-7xl mx-auto px-4 md:px-8 pt-14 md:pt-20 pb-10 md:pb-14">
          {isSearching ? (
            <>
              <p className="text-[11px] uppercase tracking-widest text-red-400 font-semibold font-mono mb-2">
                Rezultate për
              </p>
              <h1 className="font-display text-2xl md:text-4xl font-extrabold tracking-tight leading-none flex items-center gap-3 text-white">
                "{keyword}"
                <button onClick={clearSearch} className="p-1 rounded-full hover:bg-red-500/10 text-gray-300 hover:text-red-400 transition-all">
                  <X className="w-5 h-5" />
                </button>
              </h1>
              {total != null && (
                <p className="text-sm mt-1.5 text-gray-300">
                  <span className="font-mono font-semibold text-white">{total.toLocaleString('de-DE')}</span> makina u gjetën
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-[11px] uppercase tracking-widest text-red-400 font-semibold mb-3 font-mono">
                Tregti direkte · Korea Jugore
              </p>
              <h1 className="font-display text-4xl md:text-6xl font-extrabold tracking-tight leading-none text-white">
                {total != null ? (
                  <><span className="font-mono">{total.toLocaleString('de-DE')}</span><span className="uppercase text-red-500"> makina</span></>
                ) : (
                  <span className="animate-pulse text-gray-500">Duke ngarkuar...</span>
                )}
              </h1>
              <p className="text-sm md:text-base mt-3 text-gray-300 max-w-md">Çmimet përfshijnë transport deri në port · all-in</p>
            </>
          )}
        </div>
      </div>

      {/* Hero search bar — plain input, sits flush in the normal page flow. */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <form onSubmit={handleHeroSearch} className="relative mx-auto max-w-xl flex items-center gap-2 rounded-lg pl-4 pr-2 py-2"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)' }}>
          <Search className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--text-3)' }} />
          <input
            type="text"
            value={heroSearch}
            onChange={e => setHeroSearch(e.target.value)}
            placeholder="BMW, Hyundai Tucson, 2020..."
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400 min-w-0"
            style={{ color: 'var(--text-1)' }}
          />
          {heroSearch && (
            <button type="button" onClick={() => setHeroSearch('')}
                    className="p-1 rounded-full text-gray-400 hover:text-red-400 transition-colors flex-shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button type="submit" className="btn-primary text-xs py-2 px-4 flex-shrink-0">
            Kërko
          </button>
        </form>
      </div>

      {/* Filters — full-width glass bar directly below the hero */}
      <div ref={filtersWrapRef}
           className="relative"
           style={{
             background: 'var(--glass-bg)',
             borderBottom: '1px solid var(--glass-border)',
             backdropFilter: 'blur(20px) saturate(140%)',
             WebkitBackdropFilter: 'blur(20px) saturate(140%)',
             boxShadow: '0 8px 24px rgba(0,0,0,0.04)',
           }}>
        <div className="absolute top-0 left-0 right-0 h-[3px]"
             style={{ background: 'linear-gradient(90deg,#7A0606,#B50909,#D34F4F,#B50909,#7A0606)' }} />
        <div className="max-w-7xl mx-auto px-4 md:px-8 pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest font-mono font-semibold" style={{ color: 'var(--text-3)' }}>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
              </span>
              Kërko &amp; Filtro
            </p>
            {total != null && (
              <p className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{total.toLocaleString('de-DE')}</span> gjithsej
              </p>
            )}
          </div>
          <Filters
            filters={filters}
            onChange={handleFilterChange}
            forceOpen={filterForceOpen}
            onForceClose={() => setFilterForceOpen(false)}
          />
        </div>
      </div>

      {/* Desktop floating Filtra button — scrolls back to filter row */}
      {!filtersVisible && (
        <div className="hidden sm:flex fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none">
          <button
            onClick={() => filtersWrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="pointer-events-auto flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all active:scale-95"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-2)',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
            }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Filtra
            {Object.values(filters).filter(Boolean).length > 0 && (
              <span className="text-[10px] font-bold font-mono bg-red-600 text-white px-1.5 py-0.5 rounded-full leading-none">
                {Object.values(filters).filter(Boolean).length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Grid */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/25 rounded-xl text-red-300 text-sm">
            ⚠ {error}
          </div>
        )}

        {cars.length === 0 && loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 16 }).map((_, i) => (
              <div key={i} className="rounded-2xl overflow-hidden animate-pulse" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div style={{ aspectRatio: '16/10', background: 'var(--bg-card2)' }} />
                <div className="p-4 space-y-3">
                  <div className="h-4 rounded w-3/4" style={{ background: 'var(--border)' }} />
                  <div className="h-3 rounded w-1/2" style={{ background: 'var(--border)' }} />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <div key={j} className="h-3 rounded" style={{ background: 'var(--border-lo)' }} />
                    ))}
                  </div>
                  <div className="pt-2 flex justify-between">
                    <div className="h-5 rounded w-1/3" style={{ background: 'var(--border)' }} />
                    <div className="h-3 rounded w-10" style={{ background: 'var(--border)' }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {cars.length === 0 && !loading && (
          <div className="text-center py-24">
            <p className="text-lg font-medium" style={{ color: 'var(--text-3)' }}>Nuk u gjetën makina</p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-4)' }}>Provo të ndryshosh filtrat ose kërkimin</p>
          </div>
        )}

        {cars.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cars.map(car => <CarCard key={`${car.Id}-${car.Price}`} car={car} />)}
          </div>
        )}

        {/* Sentinel — always in DOM so IntersectionObserver always has a target */}
        <div ref={sentinel} className="h-16 flex items-center justify-center mt-6 pointer-events-none">
          {loading && cars.length > 0 && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-3)' }}>
              <span className="w-4 h-4 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin" />
              Duke ngarkuar...
            </div>
          )}
          {done && cars.length > 0 && (
            <p className="text-xs font-mono" style={{ color: 'var(--text-4)' }}>
              Të gjitha {total?.toLocaleString('de-DE')} makina u ngarkuan
            </p>
          )}
        </div>

        {/* WHY US — appears inline when all cars are loaded */}
        {done && cars.length > 0 && (
          <div className="mt-10 pt-10" style={{ borderTop: '1px solid var(--border-lo)' }}>
            <div className="text-center mb-8">
              <p className="text-[11px] uppercase tracking-widest text-red-500/70 font-semibold font-mono mb-2">
                Avantazhi ynë
              </p>
              <h2 className="font-display text-2xl font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
                Pse të na zgjidhni ne?
              </h2>
              <p className="text-sm mt-2 max-w-lg mx-auto" style={{ color: 'var(--text-3)' }}>
                Importojmë direkt nga Korea Jugore — pa ndërmjetës, pa surpriza. Transparencë totale.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {TRUST_CHECKLIST.map(([Icon, text]) => (
                <div key={text}
                  className="group relative overflow-hidden rounded-2xl p-4 text-center transition-all"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(181,9,9,0.3)'; e.currentTarget.style.boxShadow = '0 10px 20px rgba(181,9,9,0.1)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div className="mx-auto w-9 h-9 rounded-xl bg-red-500/10 flex items-center justify-center mb-2.5 group-hover:bg-red-500/15 transition-colors">
                    <Icon className="w-4 h-4 text-red-500" />
                  </div>
                  <h3 className="font-display font-bold text-xs leading-snug" style={{ color: 'var(--text-1)' }}>{text}</h3>
                </div>
              ))}
            </div>
            <div className="mt-8 text-center">
              <a href={waLink()} target="_blank" rel="noopener noreferrer"
                 className="btn-primary px-8 py-3 text-sm inline-flex items-center gap-2">
                💬 Na Kontaktoni Tani
              </a>
              <p className="text-xs mt-2" style={{ color: 'var(--text-4)' }}>Pa asnjë angazhim · Konsultë falas</p>
            </div>
          </div>
        )}
      </div>

      {/* Brand marquee — scrolls each brand's logo from src/lib/logos.js when
          a matching file exists in public/logos/, otherwise falls back to
          the plain brand name. */}
      <div className="marquee-wrap overflow-hidden" style={{ borderTop: '1px solid var(--border-lo)', background: 'var(--bg-card)' }}>
        <div
          className="py-3"
          style={{
            maskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
            WebkitMaskImage: 'linear-gradient(90deg, transparent, black 8%, black 92%, transparent)',
          }}
        >
          <div className="marquee-track flex w-max items-center gap-10">
            {[...BRANDS, ...BRANDS].map((b, i) => <MarqueeItem key={i} brand={b} />)}
          </div>
        </div>
      </div>

      {/* Trust checklist — red pill row, quick reassurance further down the page. */}
      <div style={{ borderTop: '1px solid var(--border-lo)', background: 'var(--bg-card2)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-3 flex flex-wrap items-center justify-center sm:justify-start gap-2">
          {TRUST_CHECKLIST.map(([Icon, text]) => (
            <span key={text}
                  className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1 rounded-full text-[11px] sm:text-xs font-medium"
                  style={{ background: 'rgba(181,9,9,0.08)', border: '1px solid rgba(181,9,9,0.18)', color: 'var(--text-2)' }}>
              <Icon className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />{text}
            </span>
          ))}
        </div>
      </div>

      {/* Operational facts — plain stacked list, deliberately quiet/graphite
          so it reads as logistics info rather than marketing. */}
      <div style={{ borderBottom: '1px solid var(--border-lo)', background: 'var(--bg-card2)' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 pb-4">
          <ul className="space-y-1.5">
            {INFO_BLOCKS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-2 text-sm pl-3" style={{ borderLeft: '2px solid #15171B', color: 'var(--text-2)' }}>
                <Icon className="w-3.5 h-3.5 text-graphite flex-shrink-0" />
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Why Choose Us */}
      <section style={{ borderTop: '1px solid var(--border-lo)', marginTop: '2rem' }}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-16 md:py-20">
          <div className="text-center mb-12">
            <p className="text-[11px] uppercase tracking-widest text-red-500/70 font-semibold font-mono mb-3">
              Avantazhi ynë
            </p>
            <h2 className="font-display text-2xl md:text-3xl font-extrabold tracking-tight" style={{ color: 'var(--text-1)' }}>
              Pse të na zgjidhni ne?
            </h2>
            <p className="text-sm mt-3 max-w-xl mx-auto" style={{ color: 'var(--text-3)' }}>
              Importojmë direkt nga Korea Jugore — pa ndërmjetës, pa surpriza.
              Transparencë totale nga listëzimi deri te porti juaj.
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {TRUST_CHECKLIST.map(([Icon, text]) => (
              <div key={text}
                className="group relative overflow-hidden rounded-2xl p-6 text-center transition-all hover:-translate-y-1"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(181,9,9,0.3)'; e.currentTarget.style.boxShadow = '0 12px 24px rgba(181,9,9,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <div className="mx-auto w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center mb-4 group-hover:bg-red-500/15 transition-colors">
                  <Icon className="w-5 h-5 text-red-500" />
                </div>
                <h3 className="font-display font-bold text-sm leading-snug" style={{ color: 'var(--text-1)' }}>{text}</h3>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 w-0 group-hover:w-2/3 transition-all duration-300"
                     style={{ background: 'linear-gradient(90deg,#D34F4F,#B50909)' }} />
              </div>
            ))}
          </div>
          <div className="mt-12 text-center">
            <a href={waLink()} target="_blank" rel="noopener noreferrer" className="btn-primary px-8 py-3 text-sm inline-flex items-center gap-2">
              Na Kontaktoni Tani
            </a>
            <p className="text-xs mt-3" style={{ color: 'var(--text-4)' }}>Pa asnjë angazhim · Konsultë falas</p>
          </div>
        </div>
      </section>
    </div>
  );
}
