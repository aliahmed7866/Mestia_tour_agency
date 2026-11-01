import {parseNbgRates} from '../../lib/display-preferences';

export async function GET() {
  try {
    const response = await fetch('https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json', {
      signal: AbortSignal.timeout(8000), headers: {Accept: 'application/json'},
      cf: {cacheTtl: 3600, cacheEverything: true},
    });
    if (!response.ok) throw new Error('Rates unavailable');
    return Response.json(parseNbgRates(await response.json()), {headers: {'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff'}});
  } catch {
    return Response.json({error: 'Currency estimates are unavailable. Prices are shown in GEL.'}, {status: 503, headers: {'Cache-Control': 'no-store'}});
  }
}
