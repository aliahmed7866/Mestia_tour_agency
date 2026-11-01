import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNbgRates, displayPrice, readPreferences} from '../app/lib/display-preferences.ts';
const NOW = Date.parse('2030-10-10T12:00:00Z');
const sample = () => [{date: '2030-10-10T00:00:00.000Z', currencies: [
  {code: 'USD', rate: 2.5, quantity: 1}, {code: 'EUR', rate: 30, quantity: 10}, {code: 'GBP', rate: 4, quantity: 1},
]}];
test('NBG quantities are inverted for GEL conversion without altering the base amount', () => {
  const data = parseNbgRates(sample(), NOW);
  assert.equal(data.date, '2030-10-10');
  assert.deepEqual(displayPrice(100.25, 'USD', data.rates), {amount: 40.1, currency: 'USD', approximate: true});
  assert.equal(data.rates.EUR, 1 / 3);
  assert.deepEqual(displayPrice(100.25, 'GEL', data.rates), {amount: 100.25, currency: 'GEL', approximate: false});
});
test('invalid, incomplete, stale and future rates are rejected', () => {
  for (const value of [null, {}, [], [{...sample()[0], date: 'bad'}], [{...sample()[0], date: '2030-10-11'}], [{...sample()[0], date: '2030-09-01'}]]) assert.throws(() => parseNbgRates(value, NOW));
  for (const rate of [0, -1, Infinity, NaN, '2.5']) {const data = sample(); data[0].currencies[0].rate = rate; assert.throws(() => parseNbgRates(data, NOW));}
  const partial = sample(); partial[0].currencies.pop(); assert.throws(() => parseNbgRates(partial, NOW));
  const badQuantity = sample(); badQuantity[0].currencies[0].quantity = 0; assert.throws(() => parseNbgRates(badQuantity, NOW));
});
test('unavailable rates retain precise GEL prices and never relabel them as foreign currency', () => {
  for (const rate of [undefined, 0, -1, Infinity, NaN]) assert.deepEqual(displayPrice(99.95, 'USD', {USD: rate}), {amount: 99.95, currency: 'GEL', approximate: false});
});
test('preferences accept supported values and tolerate blocked or corrupt storage', () => {
  assert.deepEqual(readPreferences({getItem: key => key.endsWith('language') ? 'ka' : 'EUR'}), {language: 'ka', currency: 'EUR'});
  assert.deepEqual(readPreferences({getItem: () => 'invalid'}), {language: 'en', currency: 'GEL'});
  assert.deepEqual(readPreferences({getItem: () => {throw new Error('blocked');}}), {language: 'en', currency: 'GEL'});
});

test('exchange-rate endpoint serves validated rates and safe failures without leaking upstream errors', async t => {
  const {registerHooks} = await import('node:module');
  const {existsSync} = await import('node:fs');
  registerHooks({resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return {url: url.href, shortCircuit: true};
    }
    return next(specifier, context);
  }});
  const {GET} = await import('../app/api/exchange-rates/route.ts');
  t.mock.timers.enable({apis: ['Date'], now: NOW});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json');
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(sample());
  });
  const success = await GET();
  assert.equal(success.status, 200);
  assert.equal((await success.json()).rates.USD, 0.4);
  assert.match(success.headers.get('cache-control'), /max-age=3600/);
  for (const mock of [async () => new Response('', {status: 500}), async () => {throw new Error('upstream details');}, async () => Response.json([])]) {
    t.mock.method(globalThis, 'fetch', mock);
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match((await response.json()).error, /Prices are shown in GEL/);
  }
});
