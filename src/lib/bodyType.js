// Body type (SUV / Sedan / Coupé ...) for Encar searches.
//
// Encar classifies every car into one `Category` (verified 2026-10-01):
// 경차 light, 소형차 small, 준중형차 compact, 중형차 mid-size, 대형차 large,
// 스포츠카 sports car, SUV, RV, 경승합차/승합차 vans, 화물차 trucks/pickups, 기타.
// Those are exact, live, server-side filters, so most body types map onto them
// directly and keep Encar's own counts and paging.
//
// Coupé, convertible and estate are NOT Encar categories -- a GLC Coupé is
// filed under SUV, a C-Class coupé under mid-size. The only place Encar says
// "coupé" is the model/trim text ("GLC300 4MATIC 쿠페", "4시리즈 그란쿠페"), so
// those are matched on that text instead.

// Category-backed body types -> Encar Category values.
export const BODY_CATEGORIES = {
  suv:        ['SUV'],
  sedan:      ['준중형차', '중형차', '대형차'],
  subcompact: ['경차', '소형차'],
  minivan:    ['RV', '승합차', '경승합차'],
  sports:     ['스포츠카'],
  pickup:     ['화물차'],
};

// Text-backed body types -> what Encar writes in Model/Badge for them.
export const BODY_TEXT = {
  coupe:  /쿠페|coupe/i,
  cabrio: /컨버터블|카브리올레|카브리오|로드스터|스파이더|cabrio|convertible|roadster|spyder|spider/i,
  wagon:  /왜건|투어링|아반트|에스테이트|슈팅\s*브레이크|wagon|touring|avant|estate|shooting\s*brake/i,
};

// English and German names a caller may send (kimports uses both).
const ALIASES = {
  suv: 'suv',
  sedan: 'sedan', limousine: 'sedan', saloon: 'sedan',
  subcompact: 'subcompact', 'subcompact car': 'subcompact', kleinwagen: 'subcompact', small: 'subcompact',
  minivan: 'minivan', van: 'minivan', mpv: 'minivan',
  sports: 'sports', 'sports car': 'sports', sportscar: 'sports', sportwagen: 'sports',
  coupe: 'coupe', 'coupé': 'coupe', coupes: 'coupe',
  cabrio: 'cabrio', convertible: 'cabrio', cabriolet: 'cabrio',
  wagon: 'wagon', kombi: 'wagon', estate: 'wagon',
  pickup: 'pickup',
};

export const BODY_LABELS = {
  suv: 'SUV', sedan: 'Sedan', subcompact: 'Subcompact', minivan: 'Minivan', sports: 'Sports car',
  pickup: 'Pickup', coupe: 'Coupe', cabrio: 'Cabrio', wagon: 'Wagon',
};

export const BODY_VALUES = Object.keys(BODY_LABELS);

/**
 * Parses `body=SUV,coupe` into the category-backed and text-backed parts.
 * Unknown values are returned rather than dropped, so the caller can refuse
 * them instead of silently answering a different question.
 */
export function parseBodies(raw) {
  const cats = new Set(), texts = new Set(), unknown = [];
  for (const v of String(raw || '').split(',')) {
    const k = v.trim().toLowerCase();
    if (!k || k === 'all' || k === 'alle') continue;
    const key = ALIASES[k];
    if (!key) unknown.push(v.trim());
    else if (BODY_CATEGORIES[key]) cats.add(key);
    else texts.add(key);
  }
  return { cats: [...cats], texts: [...texts], unknown };
}

/** One Encar filter term for the chosen category-backed body types. */
export function categoryPart(cats) {
  const values = cats.flatMap(k => BODY_CATEGORIES[k]);
  if (values.length === 1) return `Category.${values[0]}`;
  return `(Or.${values.map(v => `Category.${v}.`).join('_.')})`;
}

/** The text-backed body type a row shows in its model/trim, or null. */
export function textBody(car, only = Object.keys(BODY_TEXT)) {
  const text = `${car?.Model || ''} ${car?.Badge || ''} ${car?.BadgeDetail || ''}`;
  for (const k of only) if (BODY_TEXT[k].test(text)) return k;
  // Volvo's V-line (V40/V60/V90) are estates by name.
  if (only.includes('wagon') && car?.Manufacturer === '볼보' && /^V[4-9]0\b/.test(String(car.Model || ''))) return 'wagon';
  return null;
}
