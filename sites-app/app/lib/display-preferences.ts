export type DisplayCurrency = 'GEL' | 'USD' | 'EUR' | 'GBP';
export type DisplayLanguage = 'en' | 'ka';
export type ExchangeRates = {date: string; rates: Partial<Record<DisplayCurrency, number>>};
export const displayCurrencies = ['GEL', 'USD', 'EUR', 'GBP'] as const;

export function readPreferences(storage: Pick<Storage, 'getItem'>) {
  let language: DisplayLanguage = 'en', currency: DisplayCurrency = 'GEL';
  try {
    const lang = storage.getItem('svaneti-language'), money = storage.getItem('svaneti-currency');
    if (lang === 'en' || lang === 'ka') language = lang;
    if (displayCurrencies.includes(money as DisplayCurrency)) currency = money as DisplayCurrency;
  } catch { /* Browser storage is optional. */ }
  return {language, currency};
}

// NBG quotes GEL per quantity of foreign currency. Display conversion needs its inverse.
export function parseNbgRates(value: unknown, now = Date.now()): ExchangeRates {
  if (!Array.isArray(value)) throw new Error('Exchange rates unavailable.');
  const latest = value.filter(row => row && typeof row.date === 'string' && Array.isArray(row.currencies)
    && Date.parse(row.date) <= now && Date.parse(row.date) >= now - 7 * 86400000)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0];
  if (!latest) throw new Error('Exchange rates are out of date.');
  const rates: ExchangeRates['rates'] = {};
  for (const code of displayCurrencies.filter(code => code !== 'GEL')) {
    const row = latest.currencies.find((row: {code?: string}) => row?.code === code);
    if (!row || typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0
      || !Number.isInteger(row.quantity) || row.quantity <= 0) throw new Error('Exchange rates incomplete.');
    const rate = row.quantity / row.rate;
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Exchange rate invalid.');
    rates[code] = rate;
  }
  return {date: latest.date.slice(0, 10), rates};
}

export function displayPrice(amount: number, requested: DisplayCurrency, rates: ExchangeRates['rates']) {
  const rate = rates[requested];
  const converted = requested !== 'GEL' && typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
  return {amount: converted ? amount * rate : amount, currency: converted ? requested : 'GEL', approximate: converted};
}
