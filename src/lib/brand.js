export const BRAND = {
  name: 'Auto Korea Blendi',
  shortName: 'Blendi',
  tagline: 'AUTO BLENDI – Zgjedhja juaj e duhur',
  logoPath: '/logo.png',

  phone: {
    primary: '+383 44 555 630',
    primaryDisp: '044 555 630',
    primaryWa: '38344555630',
    secondary: '+49 160 95725773',
    secondaryDisp: '0160 9572 5773',
  },

  email: 'shendillapashtica@gmail.com',

  address: {
    line: 'Magjistrale Prishtinë–Ferizaj (Gadime)',
    full: '8GJ3F5JH+59, Rrugë Hasan Prishtina, Gadime e Ulët 14000',
    mapsLink: 'https://www.google.com/maps/search/?api=1&query=Rr.+Hasan+Prishtina,+Gadime+e+Ul%C3%ABt+14000',
    mapsEmbed: 'https://www.google.com/maps?q=Rr.+Hasan+Prishtina,+Gadime+e+Ul%C3%ABt+14000&output=embed',
  },

  siteUrl: 'https://autokoreablendi.com',
};

export function waLink(msg) {
  const base = `https://wa.me/${BRAND.phone.primaryWa}`;
  return msg ? `${base}?text=${encodeURIComponent(msg)}` : base;
}
