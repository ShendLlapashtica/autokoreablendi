// Encar sometimes returns text with random characters injected into it --
// "가솔린x", "일반9", "S-클-래스", "디자L인", "M 스포츠(" -- different on every
// request. Seen 2026-10-01 in a facet value fetched straight from Encar
// ("LPG(일반인 구입_)") and reported by an API client in search rows, while
// 12 other identical fetches came back clean: it is Encar's, it is sporadic,
// and there is no switch to turn it off. So responses are checked and a
// noisy one is refetched; see api/cars.js (cleanSearch).

// Encar's own value lists for these fields (its facet metadata, 2026-10-01).
export const FUEL_TYPES = new Set([
  '가솔린', '디젤', 'LPG(일반인 구입)', '가솔린+전기', '디젤+전기', 'LPG+전기',
  '가솔린+LPG', 'LPG+가솔린', '가솔린+CNG', '전기', '수소', '기타',
]);
export const SELL_TYPES = new Set(['일반', '리스', '렌트']);

const TEXT_FIELDS = ['Model', 'Badge', 'BadgeDetail'];

function balanced(s) {
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Names of the fields of one Encar row that carry injected characters. */
export function noisyFields(car) {
  const bad = [];
  if (car.FuelType != null && !FUEL_TYPES.has(car.FuelType)) bad.push('FuelType');
  if (car.SellType != null && !SELL_TYPES.has(car.SellType)) bad.push('SellType');
  for (const f of TEXT_FIELDS) {
    const s = car[f];
    if (s == null || s === '') continue;
    if (
      !balanced(s) ||
      /[가-힣][A-Za-z0-9][가-힣]/.test(s) ||   // a letter/digit inside a Hangul word: "디자L인"
      /[가-힣][-_][가-힣]/.test(s) ||          // a dash/underscore inside one:    "클-래스"
      // stray symbol after Hangul; Roman numerals are real trims ("플래티넘Ⅱ")
      /[가-힣][^\s가-힣A-Za-z0-9()+\-/.,·&'_Ⅰ-Ⅻ]/.test(s)
    ) bad.push(f);
  }
  return bad;
}

/** Rows of a response that carry noise. */
export function noisyRows(rows) {
  return (rows || []).filter(c => noisyFields(c).length > 0);
}

/**
 * Field-by-field majority across several fetches of the same page. Encar's
 * noise differs on every fetch, so the value most fetches agree on is the
 * real one. Rows keep the order of the first fetch.
 */
export function majorityMerge(responses) {
  const [first, ...rest] = responses;
  const fields = ['Manufacturer', 'Model', 'Badge', 'BadgeDetail', 'FuelType', 'SellType', 'OfficeCityState'];
  const merged = first.SearchResults.map(car => {
    const copies = [car, ...rest.map(r => r.SearchResults.find(c => c.Id === car.Id)).filter(Boolean)];
    const out = { ...car };
    for (const f of fields) {
      const tally = new Map();
      for (const c of copies) {
        if (c[f] == null) continue;
        const v = String(c[f]);
        // A value that is itself noisy never wins a tie.
        const w = noisyFields({ [f]: c[f] }).length ? 0.5 : 1;
        tally.set(v, (tally.get(v) || 0) + w);
      }
      if (tally.size) {
        const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
        out[f] = typeof car[f] === 'number' ? Number(best) : best;
      }
    }
    return out;
  });
  return { ...first, SearchResults: merged };
}
