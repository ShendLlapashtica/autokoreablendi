// Strict registry: a brand only renders a logo image if it's listed here
// AND the matching file actually exists in public/logos/. No fallback
// substitution happens in this module — components decide what to do
// when getBrandLogo() returns null (currently: render nothing).
const logoRegistry = {
  'Hyundai': 'hyundai.png',
  'Kia': 'kia.png',
  'Genesis': 'genesis.png',
  'BMW': 'bmw.png',
  'Mercedes-Benz': 'mercedes.png',
  'Audi': 'audi.png',
  'Volkswagen': 'volkswagen.png',
  'Porsche': 'porsche.png',
  'Toyota': 'toyota.png',
  'Lexus': 'lexus.png',
  'Honda': 'honda.png',
  'Volvo': 'volvo.png',
  'Ford': 'ford.png',
  'Jeep': 'jeep.png',
  'Land Rover': 'landrover.png',
  'Cadillac': 'cadillac.png',
  'Chevrolet': 'chevrolet.png',
  'Renault Korea': 'renault.png',
  'KG Mobility': 'kgmobility.png',
};

export const getBrandLogo = (brand) => {
  return logoRegistry[brand] ? `/logos/${logoRegistry[brand]}` : null;
};
