import { BRANDS } from './brandModels.js';

const FUEL_KEYWORDS = {
  'diesel': 'diesel', 'naftë': 'diesel', 'nafta': 'diesel',
  'benzinë': 'gasoline', 'benzina': 'gasoline', 'benzine': 'gasoline', 'petrol': 'gasoline', 'gasoline': 'gasoline',
  'elektrik': 'electric', 'electric': 'electric', 'ev': 'electric',
  'hibrid': 'hybrid', 'hybrid': 'hybrid',
  'lpg': 'lpg',
};

export function parseSearchQuery(q) {
  const parts   = q.trim().split(/\s+/);
  const params  = {};

  // Detect year(s)
  const yearParts = parts.filter(p => /^(19|20)\d{2}$/.test(p));
  const nonYear   = parts.filter(p => !/^(19|20)\d{2}$/.test(p));
  if (yearParts.length === 1) { params.yearFrom = yearParts[0]; params.yearTo = yearParts[0]; }
  if (yearParts.length >= 2)  { params.yearFrom = String(Math.min(...yearParts.map(Number))); params.yearTo = String(Math.max(...yearParts.map(Number))); }

  // Detect fuel
  for (const [kw, val] of Object.entries(FUEL_KEYWORDS)) {
    if (nonYear.some(p => p.toLowerCase() === kw)) { params.fuel = val; break; }
  }

  // Detect brand (try longest match first)
  let matched = '';
  for (let len = 4; len >= 1; len--) {
    const candidate = nonYear.slice(0, len).join(' ');
    if (BRANDS.some(b => b.toLowerCase() === candidate.toLowerCase())) {
      matched = BRANDS.find(b => b.toLowerCase() === candidate.toLowerCase());
      break;
    }
  }
  if (matched) {
    params.brand = matched;
    const brandWordCount = matched.split(/\s+/).length;
    const afterBrand = nonYear.slice(brandWordCount);
    const modelWords = afterBrand.filter(w => !FUEL_KEYWORDS[w.toLowerCase()]);
    if (modelWords.length > 0) params.model = modelWords.join(' ');
  }

  return params;
}
