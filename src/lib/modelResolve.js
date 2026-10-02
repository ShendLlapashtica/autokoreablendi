// Resolves a model as a caller writes it -- "E-Class", "E-클래스", "x5",
// "Sorento", "5 Series", "5시리즈 (G30)", "E-Class W213" -- onto Encar's own
// filter values, read live from Encar's facet tree:
//
//   ModelGroup  the bare model, with an English name:  E-클래스 = "E-Class"
//   Model       one generation within it:              E-클래스 W213
//
// Both are exact Encar filters (verified 2026-10-01: E-Class 4,125 cars,
// E-Class W213 3,000, BMW 5 Series 3,743, 5 Series (G30) 2,125). Before this,
// a model Encar's text did not match exactly fell back to the whole brand.

const norm = (s) => String(s || '').toLowerCase().replace(/[\s\-_.()]/g, '');

// Encar's facet text carries the same injected-character noise as its rows
// (seen: "5시리즈 (G30_)"). Every facet names its value three times --
// Value, DisplayValue and inside Expression -- and the noise hits each copy
// independently, so the value two of the three agree on is the real one.
function facetValues(iNav, field) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const m = typeof n.Expression === 'string' && n.Expression.match(new RegExp(`^${field}\\.(.+)\\.$`));
    if (m) {
      const copies = [n.Value, n.DisplayValue, m[1]].filter(v => typeof v === 'string');
      const tally = new Map();
      for (const v of copies) tally.set(v, (tally.get(v) || 0) + 1);
      const [value, votes] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      if (votes >= 2) out.push({ value, eng: n.Metadata?.EngName?.[0] ?? '', count: Number(n.Count) || 0 });
    }
    for (const k of Object.keys(n)) if (k !== 'Metadata') walk(n[k]);
  };
  walk(iNav);
  return out;
}

/** [{ value, eng, count }] for each ModelGroup in an Encar facet tree (iNav). */
export function modelGroupsFrom(iNav) {
  const out = new Map();
  for (const g of facetValues(iNav, 'ModelGroup')) out.set(g.value, g);
  return [...out.values()];
}

/**
 * Model (generation) values in an Encar facet tree: names, or with
 * withCount the { value, count } objects.
 */
export function modelsFrom(iNav, withCount = false) {
  const out = new Map();
  for (const m of facetValues(iNav, 'Model')) out.set(m.value, m);
  return withCount ? [...out.values()].map(({ value, count }) => ({ value, count })) : [...out.keys()];
}

/** [{ manufacturer, manufacturerEn, count }] from an Encar facet tree. */
export function manufacturersFrom(iNav) {
  const out = new Map();
  for (const m of facetValues(iNav, 'Manufacturer')) out.set(m.value, { manufacturer: m.value, manufacturerEn: m.eng || m.value, count: m.count });
  return [...out.values()];
}

/**
 * The ModelGroup a request names, plus whatever text follows it (a
 * generation like "W213"/"(G30)"), or null. Longest name wins, so "GLC"
 * does not swallow "GLC Coupe" where Encar lists both.
 */
export function matchGroup(groups, request) {
  const r = norm(request);
  if (!r) return null;
  let best = null;
  for (const g of groups) {
    for (const name of [g.value, g.eng]) {
      const n = norm(name);
      if (n && r.startsWith(n) && (!best || n.length > best.len)) best = { group: g, len: n.length };
    }
  }
  return best ? { group: best.group, rest: r.slice(best.len) } : null;
}

/** The one generation a leftover like "w213" / "g30" names, or null. */
export function matchModel(models, groupValue, rest) {
  if (!rest) return null;
  const hits = models.filter(m => {
    const n = norm(m);
    return n === norm(groupValue) + rest || n.endsWith(rest) || n.includes(rest);
  });
  return hits.length === 1 ? hits[0] : (hits.find(m => norm(m) === norm(groupValue) + rest) ?? null);
}
