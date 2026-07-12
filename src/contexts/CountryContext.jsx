import { createContext, useContext } from 'react';
import { durresPrice, pristinePrice } from '../lib/utils.js';

const Ctx = createContext(null);

export function CountryProvider({ children }) {
  function priceFor(manwon) {
    return durresPrice(manwon);
  }

  function secondaryPriceFor(manwon) {
    return pristinePrice(manwon);
  }

  const label           = 'deri në Durrës · all-in';
  const cityName        = 'Durrës';
  const secondaryCityName = 'Prishtinë';

  return (
    <Ctx.Provider value={{ priceFor, secondaryPriceFor, label, cityName, secondaryCityName }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCountry() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCountry must be inside CountryProvider');
  return ctx;
}
