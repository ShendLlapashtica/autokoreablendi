import { createContext, useContext } from 'react';
import { pristinePrice } from '../lib/utils.js';

const Ctx = createContext(null);

export function CountryProvider({ children }) {
  function priceFor(manwon) {
    return pristinePrice(manwon);
  }

  const label    = 'deri në Prishtinë · all-in';
  const cityName = 'Prishtinë';

  return (
    <Ctx.Provider value={{ priceFor, label, cityName }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCountry() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCountry must be inside CountryProvider');
  return ctx;
}
