import { newRequest, createQuote } from '../app/lib/domain.ts';

export const CLOCK = Date.parse('2030-10-10T00:00:00Z');
export const SETTINGS = {
  businessName: 'Test operator', whatsapp: '', discountPercent: 10,
  discountEnabled: true, policy: 'Test cancellation terms with sufficient detail.',
  privacy: 'Test privacy notice with sufficient detail.',
  operatingHours: '', policyVersion: 'test-v1',
};

export function service(id, kind, overrides = {}) {
  return {
    id, kind, title: `Test ${kind}`, description: 'A test service for workflow validation.',
    duration: '', difficulty: '', price: 100, priceBasis: 'per group',
    inclusions: '', season: '', maxGuests: 8, proposed: false,
    published: true, image: '', ...overrides,
  };
}

export function resource(id, kind, overrides = {}) {
  return { id, kind, name: `Test ${id}`, capacity: 8, bufferMinutes: 0, active: true, ...overrides };
}

export function requestInput(items = [{serviceId: 'tour', date: '2030-10-12'}], overrides = {}) {
  return {
    idempotencyKey: crypto.randomUUID(), name: 'Test Traveller',
    contact: '+995 555 123 456', guests: 2, notes: '', website: '', items,
    ...overrides,
  };
}

export function request(services = [service('tour', 'tour')], overrides = {}) {
  const items = services.map(s => s.kind === 'stay'
    ? {serviceId: s.id, date: '2030-10-12', endDate: '2030-10-15'}
    : s.kind === 'taxi'
      ? {serviceId: s.id, date: '2030-10-12', time: '10:00', pickup: 'Mestia', destination: 'Airport'}
      : {serviceId: s.id, date: '2030-10-12'});
  return {...newRequest(requestInput(items), services), ...overrides};
}

export function quoteItem(serviceId = 'tour', overrides = {}) {
  return {
    serviceId, title: `Quoted ${serviceId}`, amount: 100,
    start: '2030-10-12T10:00:00+04:00', end: '2030-10-12T12:00:00+04:00',
    resourceIds: ['guide'], units: 2, ...overrides,
  };
}

export function quoteInput(items = [quoteItem()], overrides = {}) {
  return {
    items, expiresAt: '2030-10-11T20:00:00+04:00', depositRequired: 0,
    terms: 'The test guest accepts these detailed cancellation terms.',
    policyVersion: 'test-v1', ...overrides,
  };
}

export function quotedRequest(services = [service('tour', 'tour')], items = [quoteItem()], overrides = {}) {
  const r = request(services, overrides);
  r.quote = createQuote(quoteInput(items), r, SETTINGS);
  return r;
}

export function freezeClock(t) {
  t.mock.timers.enable({apis: ['Date'], now: CLOCK});
}
