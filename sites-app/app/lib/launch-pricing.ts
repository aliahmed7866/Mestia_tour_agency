// Research recommendations, never applied to the public catalogue automatically.
// Owner rates, inclusions and actual vehicle capacity require owner approval.
export const launchPricing = {
  'proposal-ushguli': {price:300,priceBasis:'per private vehicle',duration:'Approx. 6 hours',note:'Private guided road tour. TravelMestia lists 300 GEL per vehicle; Budget Georgia’s current listing starts at 100 GEL with no clear unit in the visible price header.',source:'https://www.travelmestia.com/day-tours/ushguli'},
  'proposal-lakes': {price:350,priceBasis:'per private vehicle',duration:'Approx. 3.5–4 hours by 4×4',note:'Full 4×4 option, not the longer hiking route. TravelMestia lists 350 GEL per vehicle; Budget Georgia lists from 400 GEL / 4 hours without a clear price unit.',source:'https://www.travelmestia.com/koruldi-lakes-tour'},
  'proposal-chalaadi': {price:250,priceBasis:'per private vehicle',duration:'Approx. 3–3.5 hours',note:'Transport plus guided walk. TravelMestia lists 250 GEL per private vehicle; Budget Georgia’s current listing starts at 150 GEL / 3 hours, but the unit is unclear.',source:'https://www.travelmestia.com/one-day-tours'},
  'proposal-mazeri': {price:420,priceBasis:'per private group (one vehicle)',duration:'Approx. 6–8 hours',note:'Guided hike: TravelMestia’s 250 GEL private transfer plus 170 GEL guide totals 420 GEL. The 50 GEL shared option is self-guided and is not equivalent. Budget Georgia lists from 600 GEL / 8 hours.',source:'https://www.travelmestia.com/mazeri-waterfall-hike'},
} as const;
export type LaunchPricingKey=keyof typeof launchPricing;
