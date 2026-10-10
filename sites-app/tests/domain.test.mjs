import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestSchema, quoteSchema, validateItems, createQuote,
  assertQuoteLive, assertConfirmable, newRequest,
} from '../app/lib/domain.ts';
import {
  CLOCK, SETTINGS, service, requestInput, request, quoteItem,
  quoteInput, quotedRequest, freezeClock,
} from './fixtures.mjs';

test('requests are enquiries and copy catalogue data rather than sharing mutable prices', t => {
  freezeClock(t);
  const catalogue = [service('tour', 'tour')];
  const r = newRequest(requestInput(), catalogue);
  assert.equal(r.status, 'enquiry');
  assert.equal(r.quote, null);
  assert.equal(r.contactVerified, false);
  assert.equal(r.payment.paid, 0);
  assert.equal(r.dispatch.status, 'unassigned');
  assert.match(r.reference, /^MES-[A-F0-9]{8}$/);
  assert.ok(r.token.length >= 60);
  catalogue[0].price = 999;
  assert.equal(r.serviceSnapshots[0].price, 100);
});

test('a combined stay discounts only tours and freezes accepted totals and terms', t => {
  freezeClock(t);
  const catalogue = [service('tour', 'tour'), service('stay', 'stay'), service('taxi', 'taxi')];
  const r = request(catalogue);
  const configuration = {...SETTINGS};
  const q = createQuote(quoteInput([
    quoteItem('tour', {amount: 100.05}),
    quoteItem('stay', {amount: 300}),
    quoteItem('taxi', {amount: 80}),
  ]), r, configuration);
  assert.equal(q.subtotal, 480.05);
  assert.equal(q.discount, 10.01);
  assert.equal(q.total, 470.04);
  q.acceptedAt = new Date(CLOCK + 1000).toISOString();
  catalogue[0].price = 500;
  configuration.discountPercent = 30;
  configuration.policyVersion = 'new-policy';
  assert.equal(q.items[0].amount, 100.05);
  assert.equal(q.total, 470.04);
  assert.equal(q.policyVersion, 'test-v1');
});

test('a tour alone or a disabled stay offer receives no discount', t => {
  freezeClock(t);
  const tour = request();
  assert.equal(createQuote(quoteInput(), tour, SETTINGS).discount, 0);
  const combined = request([service('tour', 'tour'), service('stay', 'stay')]);
  assert.equal(createQuote(quoteInput([quoteItem(), quoteItem('stay')]), combined,
    {...SETTINGS, discountEnabled: false}).discount, 0);
});

test('invalid calendar dates, times, contacts and excessive group sizes fail at the request boundary', () => {
  for (const date of ['2030-02-30', '2030-13-01', '2030-00-10', '2030-10-00', 'not-a-date']) {
    assert.equal(requestSchema.safeParse(requestInput([{serviceId: 'tour', date}])).success, false, date);
  }
  assert.equal(requestSchema.safeParse(requestInput(undefined, {contact: 'no-email'})).success, false);
  assert.equal(requestSchema.safeParse(requestInput(undefined, {guests: 50})).success, true);
  assert.equal(requestSchema.safeParse(requestInput(undefined, {guests: 51})).success, false);
  assert.equal(requestSchema.safeParse(requestInput([{serviceId: 'taxi', date: '2030-10-12', time: '25:00'}])).success, false);
});

test('quote timestamps reject invalid calendar dates rather than normalizing them', () => {
  assert.equal(quoteSchema.safeParse(quoteInput([quoteItem('tour', {
    start: '2030-02-30T10:00:00+04:00', end: '2030-03-04T12:00:00+04:00',
  })])).success, false);
});

test('past dates use the Mestia calendar day and published service limits', t => {
  freezeClock(t);
  const tour = service('tour', 'tour', {maxGuests: 2});
  assert.throws(() => validateItems(requestInput([{serviceId: 'tour', date: '2030-10-09'}]), [tour]), /future date/);
  assert.doesNotThrow(() => validateItems(requestInput([{serviceId: 'tour', date: '2030-10-10'}]), [tour]));
  assert.throws(() => validateItems(requestInput(undefined, {guests: 3}), [tour]), /maximum group size/);
  const unpublished = {...tour, published: false};
  assert.throws(() => validateItems(requestInput(), [unpublished]), /no longer available/);
  assert.doesNotThrow(() => validateItems(requestInput(), [unpublished], true));
});

test('request validation rejects duplicate services, spam traps and incomplete transfers', t => {
  freezeClock(t);
  assert.throws(() => validateItems(requestInput([
    {serviceId: 'tour', date: '2030-10-12'}, {serviceId: 'tour', date: '2030-10-13'},
  ]), [service('tour', 'tour')]), /each service once/);
  assert.throws(() => validateItems(requestInput(undefined, {website: 'spam'}), [service('tour', 'tour')]), /could not be submitted/);
  assert.throws(() => validateItems(requestInput([{serviceId: 'taxi', date: '2030-10-12', time: '10:00', pickup: 'Mestia'}]), [service('taxi', 'taxi')]), /pickup, destination/);
  for (const kind of ['stay', 'taxi']) {
    assert.throws(() => validateItems(requestInput([{
      serviceId: kind, date: '2030-10-12', endDate: '2030-10-15', time: '10:00',
      pickup: 'Mestia', destination: 'Airport', departureId: crypto.randomUUID(),
    }]), [service(kind, kind)]), /Only tours.*scheduled departure/);
  }
});

test('stays need a later checkout and stay within the supported maximum', t => {
  freezeClock(t);
  const stay = service('stay', 'stay');
  for (const endDate of [undefined, '2030-10-12', '2030-10-11']) {
    assert.throws(() => validateItems(requestInput([{serviceId: 'stay', date: '2030-10-12', endDate}]), [stay]), /Check-out/);
  }
  assert.throws(() => validateItems(requestInput([{serviceId: 'stay', date: '2030-10-12', endDate: '2030-11-12'}]), [stay]), /30 nights/);
});

test('quotes require every requested service, future intervals and a covered deposit', t => {
  freezeClock(t);
  const r = request([service('tour', 'tour'), service('stay', 'stay')]);
  assert.throws(() => createQuote(quoteInput(), r, SETTINGS), /every selected service/);
  assert.throws(() => createQuote(quoteInput([quoteItem(), quoteItem()]), r, SETTINGS), /every selected service/);
  const one = request();
  assert.throws(() => createQuote(quoteInput([quoteItem('tour', {end: '2030-10-12T09:00:00+04:00'})]), one, SETTINGS), /end after its start/);
  assert.throws(() => createQuote(quoteInput([quoteItem('tour', {start: '2030-10-09T10:00:00+04:00'})]), one, SETTINGS), /start in the past/);
  assert.throws(() => createQuote(quoteInput(undefined, {depositRequired: 101}), one, SETTINGS), /deposit cannot exceed/);
  assert.throws(() => createQuote(quoteInput(), {...one, status: 'confirmed'}, SETTINGS), /unconfirmed request/);
});

test('quote expiry is enforced when issued and again before acceptance or confirmation', t => {
  freezeClock(t);
  assert.throws(() => createQuote(quoteInput(undefined, {expiresAt: new Date(CLOCK).toISOString()}), request(), SETTINGS), /expiry/);
  assert.throws(() => createQuote(quoteInput(undefined, {expiresAt: new Date(CLOCK + 31 * 86400000).toISOString()}), request(), SETTINGS), /expiry/);
  const r = quotedRequest();
  assert.doesNotThrow(() => assertQuoteLive(r));
  t.mock.timers.setTime(Date.parse(r.quote.expiresAt));
  assert.throws(() => assertQuoteLive(r), /expired/);
});

test('confirmation separately requires guest acceptance, two-way contact, and verified deposit', t => {
  freezeClock(t);
  const r = quotedRequest();
  r.quote.depositRequired = 50;
  assert.throws(() => assertConfirmable(r), /guest must accept/);
  r.quote.acceptedAt = new Date(CLOCK + 1000).toISOString();
  assert.throws(() => assertConfirmable(r), /contact verification/);
  r.contactVerified = true;
  assert.throws(() => assertConfirmable(r), /deposit/);
  r.payment.paid = 49.99;
  assert.throws(() => assertConfirmable(r), /deposit/);
  r.payment.paid = 50;
  assert.doesNotThrow(() => assertConfirmable(r));
  r.status = 'cancelled';
  assert.throws(() => assertConfirmable(r), /closed or confirmed/);
});
