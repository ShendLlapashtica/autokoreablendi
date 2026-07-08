// Short monogram for a manufacturer name, used as a lightweight stand-in
// for brand logos (no third-party trademark assets are bundled/fetched).
export function brandInitials(name) {
  if (!name) return '?';
  const s = String(name).trim();
  if (!s) return '?';

  // Already a short all-caps acronym (e.g. "BMW") — keep as-is.
  if (s.length <= 3 && s === s.toUpperCase()) return s;

  const words = s.split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return words.map(w => w[0]).join('').toUpperCase().slice(0, 3);
  return s.slice(0, 2).toUpperCase();
}
