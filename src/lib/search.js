import { BRANDS } from './brandModels.js';

const FUEL_KEYWORDS = {
  'diesel': 'diesel', 'naftë': 'diesel', 'nafta': 'diesel',
  'benzinë': 'gasoline', 'benzina': 'gasoline', 'benzine': 'gasoline', 'petrol': 'gasoline', 'gasoline': 'gasoline',
  'elektrik': 'electric', 'electric': 'electric', 'ev': 'electric',
  'hibrid': 'hybrid', 'hybrid': 'hybrid',
  'lpg': 'lpg',
};

// Short forms people actually type that don't match the dropdown's full
// canonical name (e.g. everyone types "mercedes", nobody types "mercedes-benz") —
// verified live that "mercedes amg gt" silently matched zero brand and fell
// through to a keyword search before this map existed.
const BRAND_ALIASES = {
  'mercedes': 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  'benz': 'Mercedes-Benz',
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

  // Detect brand (try longest match first). `consumedWords` tracks how many
  // *original* words the match ate — using the matched name's own word count
  // instead (e.g. "Mercedes-Benz".split(' ').length === 1) silently ate the
  // wrong number of words whenever an alias's word count didn't match the
  // canonical name's, corrupting everything typed after the brand.
  let matched = '';
  let consumedWords = 0;
  for (let len = 4; len >= 1; len--) {
    const candidate      = nonYear.slice(0, len).join(' ');
    const candidateLower = candidate.toLowerCase();
    const exact = BRANDS.find(b => b.toLowerCase() === candidateLower);
    if (exact) { matched = exact; consumedWords = len; break; }
    if (BRAND_ALIASES[candidateLower]) { matched = BRAND_ALIASES[candidateLower]; consumedWords = len; break; }
  }
  if (matched) {
    params.brand = matched;
    const afterBrand = nonYear.slice(consumedWords);
    const modelWords = afterBrand.filter(w => !FUEL_KEYWORDS[w.toLowerCase()]);
    if (modelWords.length > 0) params.model = modelWords.join(' ');
  }

  return params;
}
