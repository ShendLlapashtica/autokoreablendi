import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import CustomsCalculator from './CustomsCalculator.jsx';
import MobileMenu from './MobileMenu.jsx';
import { BRAND, waLink } from '../lib/brand.js';
import { parseSearchQuery } from '../lib/search.js';

export default function Header() {
  const [calc, setCalc]         = useState(false);
  const [menu, setMenu]         = useState(false);
  const [search, setSearch]     = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const navigate                = useNavigate();

  function handleSearch(e) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    const parsed = parseSearchQuery(q);
    const hasParsed = Object.keys(parsed).length > 0;
    if (hasParsed) {
      navigate(`/?${new URLSearchParams(parsed)}`);
    } else {
      navigate(`/?q=${encodeURIComponent(q)}`);
    }
    setShowSearch(false);
    setSearch('');
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b backdrop-blur-xl bg-white/75 border-black/[0.06]">
        <div className="max-w-7xl mx-auto px-4 md:px-8 flex items-center gap-2 h-14">

          {/* Logo */}
          <Link to="/" className="flex items-center group select-none flex-shrink-0 mr-2">
            <img src={BRAND.logoPath} alt={BRAND.name} className="h-9 w-auto" />
          </Link>

          {/* Search — desktop */}
          <form onSubmit={handleSearch} className="hidden sm:flex flex-1 max-w-sm">
            <div className="relative w-full">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none">🔍</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="BMW, Hyundai Tucson, 2020..."
                className="input pl-8 text-sm h-9"
              />
            </div>
          </form>

          <div className="flex items-center gap-1 ml-auto">

            <a href={waLink()} target="_blank" rel="noopener noreferrer"
               className="hidden sm:inline-flex btn-primary text-xs py-1.5 px-3">
              WhatsApp
            </a>

            {/* Mobile: search icon */}
            <button
              onClick={() => setShowSearch(s => !s)}
              className="sm:hidden flex w-9 h-9 items-center justify-center rounded-lg btn-ghost text-base p-0"
            >
              {showSearch ? <X className="w-4 h-4" /> : '🔍'}
            </button>

            {/* Mobile: burger → X when menu open */}
            <button
              onClick={() => setMenu(o => !o)}
              className="sm:hidden flex w-9 h-9 items-center justify-center rounded-lg btn-ghost p-0"
              aria-label={menu ? 'Mbyll menunë' : 'Hap menunë'}
            >
              {menu ? (
                <X className="w-5 h-5" style={{ color: 'var(--text-1)' }} />
              ) : (
                <div className="flex flex-col justify-center gap-[6px]">
                  <span style={{ display:'block', width:'22px', height:'3px', borderRadius:'3px', background:'linear-gradient(90deg,#D34F4F,#B50909)' }} />
                  <span style={{ display:'block', width:'22px', height:'3px', borderRadius:'3px', background:'linear-gradient(90deg,#C22020,#B50909)' }} />
                  <span style={{ display:'block', width:'22px', height:'3px', borderRadius:'3px', background:'linear-gradient(90deg,#B50909,#7A0606)' }} />
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Mobile search bar */}
        {showSearch && (
          <div className="sm:hidden px-4 pb-3">
            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="BMW, 2020, Hyundai Tucson..."
                className="input flex-1 text-sm h-10"
              />
              <button type="submit" className="btn-primary px-4 h-10 text-sm">
                🔍
              </button>
            </form>
          </div>
        )}
      </header>

      {calc && <CustomsCalculator onClose={() => setCalc(false)} />}
      {menu && (
        <MobileMenu
          onClose={() => setMenu(false)}
          onOpenCalc={() => { setMenu(false); setCalc(true); }}
        />
      )}
    </>
  );
}
