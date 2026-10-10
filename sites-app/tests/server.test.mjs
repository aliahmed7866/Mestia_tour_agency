import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { SQLiteD1 } from './sqlite-d1.mjs';
import { SETTINGS, CLOCK, service, resource, requestInput, quotedRequest, quoteInput, quoteItem, freezeClock } from './fixtures.mjs';

// Cloudflare's runtime env is injected only for this Node test process.
globalThis.__mestiaTestEnv = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return {url: 'mestia-test:env', shortCircuit: true};
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(candidate)) return {url: candidate.href, shortCircuit: true};
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mestia-test:env') return {
      format: 'module', source: 'export const env = globalThis.__mestiaTestEnv;', shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const server = await import('../app/lib/server.ts');

const ORIGIN = 'https://mestia.test';
const ownerRequest = (id = 'owner') => new Request(ORIGIN + '/api/admin', {
  method: 'POST', headers: {origin: ORIGIN, 'oai-authenticated-user-id': id},
});
const guestRequest = () => new Request(ORIGIN + '/api/request', {method: 'POST', headers: {origin: ORIGIN}});
const isError = (status, message) => error => error.status === status && (!message || message.test(error.message));

function world(t, resources = [resource('guide', 'guide')], services = [service('tour', 'tour')]) {
  freezeClock(t);
  const db = new SQLiteD1();
  globalThis.__mestiaTestEnv.DB = db;
  db.sqlite.prepare('INSERT INTO settings (id,data) VALUES (?,?)').run('business', JSON.stringify({...SETTINGS, adminUserId: 'owner'}));
  for (const s of services) db.sqlite.prepare('INSERT INTO services (id,data) VALUES (?,?)').run(s.id, JSON.stringify(s));
  for (const r of resources) db.sqlite.prepare('INSERT INTO resources (id,data) VALUES (?,?)').run(r.id, JSON.stringify(r));
  t.after(() => db.close());
  return db;
}

function insertRequest(db, r) {
  db.sqlite.prepare('INSERT INTO requests (id,token,idempotency,data,version) VALUES (?,?,?,?,?)')
    .run(r.id, r.token, crypto.randomUUID(), JSON.stringify(r), r.version);
  return r;
}

function confirmable(db, services = [service('tour', 'tour')], items = [quoteItem()], overrides = {}) {
  const r = quotedRequest(services, items, overrides);
  r.quote.acceptedAt = new Date(CLOCK).toISOString();
  r.contactVerified = true;
  return insertRequest(db, r);
}

test('owner routes reject anonymous and non-owner identities before returning or editing records', async t => {
  world(t);
  await assert.rejects(server.adminData(ownerRequest('')), isError(401));
  await assert.rejects(server.adminData(ownerRequest('other-user')), isError(403));
  await assert.rejects(server.mutateAdmin(ownerRequest('other-user'), {action: 'saveSettings', settings: SETTINGS}), isError(403));
  const admin = await server.adminData(ownerRequest());
  assert.equal(admin.initialized, true);
  assert.equal(admin.identity, 'owner');
  assert.equal('adminUserId' in admin.settings, false);
});

test('initial owner claim is atomic and cannot overwrite an already assigned owner', async t => {
  const db = world(t);
  db.sqlite.prepare('DELETE FROM settings').run();
  const empty = await server.adminData(ownerRequest('first-owner'));
  assert.equal(empty.initialized, false);
  assert.deepEqual(empty.requests, []);
  const results = await Promise.allSettled([
    server.bootstrap(ownerRequest('first-owner')), server.bootstrap(ownerRequest('second-owner')),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  const settings = await server.getSettings();
  assert.ok(['first-owner', 'second-owner'].includes(settings.adminUserId));
  await assert.rejects(server.bootstrap(ownerRequest('third-owner')), isError(409));
  await assert.rejects(server.requireAdmin(ownerRequest('third-owner')), isError(403));
});

test('cross-origin writes and oversized or malformed request bodies are rejected', async t => {
  world(t);
  await assert.rejects(server.mutateAdmin(new Request(ORIGIN + '/api/admin', {
    method: 'POST', headers: {origin: 'https://attacker.test', 'oai-authenticated-user-id': 'owner'},
  }), {action: 'saveSettings', settings: SETTINGS}), isError(403));
  assert.throws(() => server.sameOrigin(new Request(ORIGIN + '/api/request')), isError(403));
  await assert.rejects(server.body(new Request(ORIGIN, {method: 'POST', body: 'x'.repeat(65537)})), isError(413));
  await assert.rejects(server.body(new Request(ORIGIN, {method: 'POST', body: '{bad'})), isError(400));
  for (const payload of ['null', '[]', '"text"', 'true']) {
    await assert.rejects(server.body(new Request(ORIGIN, {method: 'POST', body: payload})), isError(400));
  }
  await assert.rejects(server.body(new Request(ORIGIN, {method: 'POST', body: JSON.stringify({notes: 'შ'.repeat(30000)})})), isError(413));
});

test('guest links expose only that request and expire or revoke when renewed', async t => {
  const db = world(t);
  const r = confirmable(db);
  r.contactEvidence = 'Internal contact verification note';
  db.sqlite.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id);
  const response = await server.guestAction(guestRequest(), {action: 'view', token: r.token});
  assert.equal(response.request.reference, r.reference);
  for (const field of ['id', 'token', 'contact', 'contactEvidence']) assert.equal(field in response.request, false, field);
  assert.equal('driverId' in response.request.dispatch, false);
  assert.ok(response.request.history.every(h => !('actor' in h)));
  assert.deepEqual(response.request.history, []);
  assert.deepEqual(response.request.payment.entries, []);
  await assert.rejects(server.byToken('bad-token'), isError(404));
  await assert.rejects(server.byToken(crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')), isError(404));
  await server.mutateAdmin(ownerRequest(), {action: 'renewLink', requestId: r.id});
  await assert.rejects(server.byToken(r.token), isError(404));
  const updated = await server.getTravelRequest(r.id);
  assert.notEqual(updated.token, r.token);
  t.mock.timers.setTime(Date.parse(updated.tokenExpiresAt));
  await assert.rejects(server.byToken(updated.token), isError(410));
});

test('guest acceptance requires current quote and explicit terms and does not confirm inventory', async t => {
  const db = world(t);
  const r = quotedRequest();
  insertRequest(db, r);
  await assert.rejects(server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: 'old', acceptTerms: true}), isError(409));
  await assert.rejects(server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: false}), isError(400));
  await server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true});
  const accepted = await server.getTravelRequest(r.id);
  assert.ok(accepted.quote.acceptedAt);
  assert.equal(accepted.status, 'enquiry');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations').get().n, 0);
  assert.equal(accepted.version, 1);
  await server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true});
  assert.equal((await server.getTravelRequest(r.id)).version, 1);
});

test('confirmation race commits one booking and rolls back the losing state, journal and reservations', async t => {
  const db = world(t);
  const a = confirmable(db);
  const b = confirmable(db);
  const results = await Promise.allSettled([a, b].map(r => server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id})));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const rejected = results.find(r => r.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  const records = await Promise.all([a, b].map(r => server.getTravelRequest(r.id)));
  const winner = records.find(r => r.status === 'confirmed');
  const loser = records.find(r => r.status === 'enquiry');
  assert.ok(winner && loser);
  assert.equal(winner.version, 1);
  assert.equal(loser.version, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(loser.id).n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations WHERE key=?').get(loser.id + ':v0').n, 0);
  assert.ok(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(winner.id).n > 0);
});

test('two simultaneous changes to one version cannot both commit', async t => {
  const db = world(t);
  const r = confirmable(db);
  const results = await Promise.allSettled([
    server.mutateAdmin(ownerRequest(), {action: 'verifyContact', requestId: r.id, contactEvidence: 'First checked contact'}),
    server.mutateAdmin(ownerRequest(), {action: 'verifyContact', requestId: r.id, contactEvidence: 'Second checked contact'}),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.status, 409);
  assert.equal((await server.getTravelRequest(r.id)).version, 1);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations').get().n, 1);
});

test('a conflict in a later item rolls back all earlier reservations for the combined request', async t => {
  const db = world(t, [resource('guide', 'guide'), resource('room', 'room', {capacity: 2})]);
  const earlier = confirmable(db);
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: earlier.id});
  const combined = confirmable(db, [service('stay', 'stay'), service('tour', 'tour')], [
    quoteItem('stay', {resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00'}),
    quoteItem('tour'),
  ]);
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: combined.id}), isError(409));
  assert.equal((await server.getTravelRequest(combined.id)).status, 'enquiry');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(combined.id).n, 0);
});

test('night inventory accepts checkout-day arrival and cancellation releases commitments', async t => {
  const stay = service('stay', 'stay');
  const db = world(t, [resource('room', 'room', {capacity: 2})], [stay]);
  const first = confirmable(db, [stay], [quoteItem('stay', {resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00'})]);
  const next = confirmable(db, [stay], [quoteItem('stay', {resourceIds: ['room'], start: '2030-10-15T15:00:00+04:00', end: '2030-10-17T11:00:00+04:00'})]);
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: first.id});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: next.id});
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations').get().n, 5);
  await server.mutateAdmin(ownerRequest(), {action: 'cancel', requestId: first.id, reason: 'Guest changed travel plans'});
  assert.equal((await server.getTravelRequest(first.id)).status, 'cancelled');
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(first.id).n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(next.id).n, 2);
});

test('departure seat capacity is enforced across independent bookings and oversubscription is rejected', async t => {
  const db = world(t, [resource('guide-a', 'guide'), resource('guide-b', 'guide'), resource('guide-c', 'guide'), resource('departure', 'departure', {capacity: 4})]);
  await server.mutateAdmin(ownerRequest(), {action: 'setTourLimit', maxConcurrentTours: 3});
  const booking = guide => confirmable(db, [service('tour', 'tour')], [quoteItem('tour', {resourceIds: [guide, 'departure']})]);
  const a = booking('guide-a'), b = booking('guide-b'), c = booking('guide-c');
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: a.id});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: b.id});
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: c.id}), isError(409));
  const occupancy = db.sqlite.prepare('SELECT slot, count(*) n FROM reservations WHERE resource_id=? GROUP BY slot').all('departure');
  assert.ok(occupancy.length > 0);
  assert.ok(occupancy.every(row => row.n === 4));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(c.id).n, 0);
});

test('resource blocks conflict with bookings, prevent future confirmations and can be released', async t => {
  const db = world(t);
  const r = confirmable(db);
  await server.mutateAdmin(ownerRequest(), {action: 'block', resourceId: 'guide', start: r.quote.items[0].start, end: r.quote.items[0].end, reason: 'Guide away'});
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id}), isError(409));
  const block = db.sqlite.prepare('SELECT id FROM blocks').get();
  await server.mutateAdmin(ownerRequest(), {action: 'unblock', blockId: block.id});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'block', resourceId: 'guide', start: r.quote.items[0].start, end: r.quote.items[0].end, reason: 'Guide away'}), isError(409));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM blocks').get().n, 0);
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'saveResource', resource: resource('guide', 'guide', {active: false})}), isError(409));
});

test('a resource setup edit racing confirmation cannot commit an inconsistent booking', async t => {
  const db = world(t);
  const r = confirmable(db);
  const results = await Promise.allSettled([
    server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id}),
    server.mutateAdmin(ownerRequest(), {action: 'saveResource', resource: resource('guide', 'guide', {active: false})}),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok([400, 409].includes(results.find(r => r.status === 'rejected').reason.status));
  const latest = await server.getTravelRequest(r.id);
  const guide = (await server.getResources()).find(r => r.id === 'guide');
  const reservations = db.sqlite.prepare('SELECT count(*) n FROM reservations WHERE request_id=?').get(r.id).n;
  if (latest.status === 'confirmed') {
    assert.equal(guide.active, true);
    assert.ok(reservations > 0);
  } else {
    assert.equal(latest.status, 'enquiry');
    assert.equal(guide.active, false);
    assert.equal(reservations, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations WHERE key=?').get(r.id + ':v0').n, 0);
  }
});

test('payment boundaries prevent overpayment, excess refunds and deposit-free confirmation', async t => {
  const db = world(t);
  const r = confirmable(db);
  r.quote.depositRequired = 50;
  db.sqlite.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id);
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id}), isError(400, /deposit/));
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'recordPayment', requestId: r.id, amount: 101, reference: 'Bank receipt'}), isError(400, /exceeds/));
  await server.mutateAdmin(ownerRequest(), {action: 'recordPayment', requestId: r.id, amount: 50, reference: 'Verified bank receipt'});
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'recordRefund', requestId: r.id, amount: 51, reference: 'Bank refund'}), isError(400, /exceed collected/));
  assert.equal((await server.getTravelRequest(r.id)).payment.paid, 50);
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  assert.equal((await server.getTravelRequest(r.id)).status, 'confirmed');
});

test('taxi dispatch requires guest fare acceptance, a live offer, suitable vehicle, and driver evidence', async t => {
  const taxi = service('taxi', 'taxi');
  const resources = [resource('driver', 'driver'), resource('vehicle', 'vehicle', {capacity: 2})];
  const db = world(t, resources, [taxi]);
  const r = quotedRequest([taxi], [quoteItem('taxi', {resourceIds: []})]);
  r.contactVerified = true;
  insertRequest(db, r);
  const action = status => ({action: 'dispatch', requestId: r.id, status, driverId: 'driver', vehicleId: 'vehicle', evidence: 'Driver accepted by phone'});
  await assert.rejects(server.mutateAdmin(ownerRequest(), action('accepted')), isError(400, /fare with the guest/));
  await server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true});
  await assert.rejects(server.mutateAdmin(ownerRequest(), action('accepted')), isError(400, /Offer this driver/));
  await server.mutateAdmin(ownerRequest(), action('offered'));
  t.mock.timers.setTime(CLOCK + 31 * 60000);
  await assert.rejects(server.mutateAdmin(ownerRequest(), action('accepted')), isError(400, /Expired offers/));
  await server.mutateAdmin(ownerRequest(), action('offered'));
  await assert.rejects(server.mutateAdmin(ownerRequest(), {...action('accepted'), evidence: ''}), isError(400, /how and when/));
  await server.mutateAdmin(ownerRequest(), action('accepted'));
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  assert.equal((await server.getTravelRequest(r.id)).status, 'confirmed');
  assert.deepEqual(db.sqlite.prepare('SELECT DISTINCT resource_id FROM reservations ORDER BY resource_id').all().map(r => r.resource_id), ['driver', 'vehicle']);
});

const dispatchResources = () => [
  resource('room', 'room', {capacity: 2}), resource('guide', 'guide'),
  resource('driver-a', 'driver'), resource('vehicle-a', 'vehicle', {capacity: 2}),
  resource('driver-b', 'driver'), resource('vehicle-b', 'vehicle', {capacity: 2}),
];
const acceptedDispatch = (suffix = 'a') => ({
  status: 'accepted', driverId: `driver-${suffix}`, vehicleId: `vehicle-${suffix}`,
  evidence: 'Driver accepted fare and timing by phone',
});
const reservationRows = (db, id) => db.sqlite.prepare('SELECT resource_id,slot,unit FROM reservations WHERE request_id=? ORDER BY resource_id,slot,unit').all(id);
const combinedTaxiItems = () => [
  quoteItem('stay', {resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00'}),
  quoteItem('tour'),
  quoteItem('taxi', {resourceIds: ['driver-a', 'vehicle-a']}),
];

test('confirmed combined booking retains stay and tour when taxi is unavailable and atomically swaps accepted resources', async t => {
  const services = [service('stay', 'stay'), service('tour', 'tour'), service('taxi', 'taxi')];
  const db = world(t, dispatchResources(), services);
  const r = confirmable(db, services, combinedTaxiItems(), {dispatch: acceptedDispatch()});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  const preserved = reservationRows(db, r.id).filter(row => ['room', 'guide', '__tour_parallel__'].includes(row.resource_id));
  assert.ok(preserved.length > 3);
  t.mock.timers.setTime(Date.parse(r.quote.expiresAt) + 60000);
  const dispatch = status => ({action: 'dispatch', requestId: r.id, ...acceptedDispatch('b'), status});
  await server.mutateAdmin(ownerRequest(), dispatch('offered'));
  assert.deepEqual(reservationRows(db, r.id), preserved);
  await server.mutateAdmin(ownerRequest(), dispatch('unavailable'));
  assert.deepEqual(reservationRows(db, r.id), preserved);
  assert.equal((await server.getTravelRequest(r.id)).status, 'confirmed');
  await server.mutateAdmin(ownerRequest(), dispatch('offered'));
  await server.mutateAdmin(ownerRequest(), dispatch('accepted'));
  const latest = await server.getTravelRequest(r.id);
  assert.equal(latest.status, 'confirmed');
  assert.equal(latest.dispatch.driverId, 'driver-b');
  const rows = reservationRows(db, r.id);
  assert.deepEqual(rows.filter(row => ['room', 'guide', '__tour_parallel__'].includes(row.resource_id)), preserved);
  assert.deepEqual([...new Set(rows.map(row => row.resource_id))].sort(), ['__tour_parallel__', 'driver-b', 'guide', 'room', 'vehicle-b']);
  assert.equal(latest.quote.total, r.quote.total);
  assert.equal(latest.quote.acceptedAt, r.quote.acceptedAt);
});

test('a busy replacement taxi fails without changing accepted quote, dispatch state or other reservations', async t => {
  const services = [service('stay', 'stay'), service('tour', 'tour'), service('taxi', 'taxi')];
  const db = world(t, dispatchResources(), services);
  const occupied = confirmable(db, [service('taxi', 'taxi')], [quoteItem('taxi', {resourceIds: []})], {dispatch: acceptedDispatch('b')});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: occupied.id});
  const r = confirmable(db, services, combinedTaxiItems(), {dispatch: acceptedDispatch()});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  const offered = {action: 'dispatch', requestId: r.id, ...acceptedDispatch('b'), status: 'offered'};
  await server.mutateAdmin(ownerRequest(), offered);
  const before = await server.getTravelRequest(r.id);
  const beforeReservations = reservationRows(db, r.id);
  const busyReservations = reservationRows(db, occupied.id);
  await assert.rejects(server.mutateAdmin(ownerRequest(), {...offered, status: 'accepted'}), isError(409));
  assert.deepEqual(await server.getTravelRequest(r.id), before);
  assert.deepEqual(reservationRows(db, r.id), beforeReservations);
  assert.deepEqual(reservationRows(db, occupied.id), busyReservations);
});

test('a replacement taxi quote requires the guest and driver to accept the revised fare and schedule', async t => {
  const taxi = service('taxi', 'taxi');
  const db = world(t, [resource('driver', 'driver'), resource('vehicle', 'vehicle', {capacity: 2})], [taxi]);
  const r = confirmable(db, [taxi], [quoteItem('taxi', {resourceIds: []})], {
    dispatch: {status: 'accepted', driverId: 'driver', vehicleId: 'vehicle', evidence: 'Driver accepted the original fare'},
  });
  await server.mutateAdmin(ownerRequest(), {
    action: 'quote', requestId: r.id,
    quote: quoteInput([quoteItem('taxi', {resourceIds: [], amount: 150, start: '2030-10-13T10:00:00+04:00', end: '2030-10-13T12:00:00+04:00'})]),
  });
  const revised = await server.getTravelRequest(r.id);
  assert.equal(revised.quote.acceptedAt, null);
  assert.equal(revised.quote.total, 150);
  assert.deepEqual(revised.dispatch, {status: 'unassigned', driverId: '', vehicleId: '', evidence: ''});
  await assert.rejects(server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true}), isError(409));
  await server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: revised.quote.id, acceptTerms: true});
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id}), isError(400, /driver must accept/));
  const dispatch = {action: 'dispatch', requestId: r.id, driverId: 'driver', vehicleId: 'vehicle', evidence: 'Driver accepted the revised fare and next-day pickup'};
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'offered'});
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'accepted'});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  assert.equal((await server.getTravelRequest(r.id)).status, 'confirmed');
  assert.ok(reservationRows(db, r.id).every(row => Number(row.slot.slice(5)) >= Date.parse('2030-10-13T10:00:00+04:00')));
});

test('a later taxi can be reassigned after package tours finish and future tour limits or guide availability change', async t => {
  const services = [service('stay', 'stay'), service('tour', 'tour'), service('taxi', 'taxi')];
  const db = world(t, [...dispatchResources(), resource('guide-other', 'guide')], services);
  await server.mutateAdmin(ownerRequest(), {action: 'setTourLimit', maxConcurrentTours: 2});
  const parallel = confirmable(db, [service('tour', 'tour')], [quoteItem('tour', {resourceIds: ['guide-other']})]);
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: parallel.id});
  const r = confirmable(db, services, [
    quoteItem('stay', {resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00'}),
    quoteItem('tour'),
    quoteItem('taxi', {resourceIds: [], start: '2030-10-13T10:00:00+04:00', end: '2030-10-13T12:00:00+04:00'}),
  ], {dispatch: acceptedDispatch()});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  const acceptedQuote = (await server.getTravelRequest(r.id)).quote;
  const preserved = reservationRows(db, r.id).filter(row => !['driver-a', 'vehicle-a'].includes(row.resource_id));
  assert.ok(preserved.filter(row => row.resource_id === '__tour_parallel__').every(row => row.unit === 2));
  t.mock.timers.setTime(Date.parse('2030-10-13T00:00:00Z'));
  await server.mutateAdmin(ownerRequest(), {action: 'setTourLimit', maxConcurrentTours: 1});
  await server.mutateAdmin(ownerRequest(), {action: 'saveResource', resource: resource('guide', 'guide', {active: false})});
  const dispatch = {action: 'dispatch', requestId: r.id, ...acceptedDispatch('b')};
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'offered'});
  assert.deepEqual(reservationRows(db, r.id), preserved);
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'accepted'});
  assert.deepEqual(reservationRows(db, r.id).filter(row => !['driver-b', 'vehicle-b'].includes(row.resource_id)), preserved);
  assert.deepEqual((await server.getTravelRequest(r.id)).quote, acceptedQuote);
  assert.equal((await server.getTravelRequest(r.id)).dispatch.driverId, 'driver-b');
});

test('taxi reassignment still rejects a vehicle committed to another service in the same confirmed package', async t => {
  const services = [service('tour', 'tour'), service('taxi', 'taxi')];
  const db = world(t, dispatchResources(), services);
  const r = confirmable(db, services, [
    quoteItem('tour', {resourceIds: ['guide', 'vehicle-b']}), quoteItem('taxi', {resourceIds: []}),
  ], {dispatch: acceptedDispatch()});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  const dispatch = {action: 'dispatch', requestId: r.id, ...acceptedDispatch('b')};
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'offered'});
  const before = await server.getTravelRequest(r.id);
  const inventoryBefore = reservationRows(db, r.id);
  await assert.rejects(server.mutateAdmin(ownerRequest(), {...dispatch, status: 'accepted'}), isError(409));
  assert.deepEqual(await server.getTravelRequest(r.id), before);
  assert.deepEqual(reservationRows(db, r.id), inventoryBefore);
  assert.ok(inventoryBefore.some(row => row.resource_id === 'vehicle-b'));
});

test('a quote cannot be newly accepted after a service starts even when its written expiry is later', async t => {
  const db = world(t);
  const r = quotedRequest(undefined, undefined);
  r.quote.expiresAt = '2030-10-15T20:00:00+04:00';
  insertRequest(db, r);
  t.mock.timers.setTime(Date.parse(r.quote.items[0].start));
  await assert.rejects(server.guestAction(guestRequest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true}), isError(400, /already started/));
  assert.equal((await server.getTravelRequest(r.id)).quote.acceptedAt, null);
  assert.equal((await server.getTravelRequest(r.id)).version, 0);
});

test('confirmed taxi reassignment supports an in-progress trip and rejects new dispatch after the trip ends', async t => {
  const taxi = service('taxi', 'taxi');
  const db = world(t, dispatchResources(), [taxi]);
  const r = confirmable(db, [taxi], [quoteItem('taxi', {resourceIds: []})], {dispatch: acceptedDispatch()});
  await server.mutateAdmin(ownerRequest(), {action: 'confirm', requestId: r.id});
  t.mock.timers.setTime(Date.parse(r.quote.items[0].start) + 30 * 60000);
  const dispatch = {action: 'dispatch', requestId: r.id, ...acceptedDispatch('b')};
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'offered'});
  await server.mutateAdmin(ownerRequest(), {...dispatch, status: 'accepted'});
  assert.equal((await server.getTravelRequest(r.id)).dispatch.driverId, 'driver-b');
  const before = await server.getTravelRequest(r.id);
  const inventoryBefore = reservationRows(db, r.id);
  t.mock.timers.setTime(Date.parse(r.quote.items[0].end));
  for (const status of ['offered', 'accepted']) {
    await assert.rejects(server.mutateAdmin(ownerRequest(), {...dispatch, status}), isError(400, /already ended/));
  }
  assert.deepEqual(await server.getTravelRequest(r.id), before);
  assert.deepEqual(reservationRows(db, r.id), inventoryBefore);
});

test('reusing a submission key with changed details never claims the changed values were saved', async t => {
  const db = world(t);
  const input = requestInput();
  const created = await server.createTravelRequest(guestRequest(), input);
  for (const changes of [{name: 'Different Traveller'}, {guests: 3}, {notes: 'Different travel requirements'}, {items: [{serviceId: 'tour', date: '2030-10-13'}]}]) {
    await assert.rejects(server.createTravelRequest(guestRequest(), {...input, ...changes}), isError(409, /different details/));
  }
  await assert.rejects(server.mutateAdmin(ownerRequest(), {action: 'createManual', request: input}), isError(409, /different details/));
  const replay = await server.createTravelRequest(guestRequest(), {...input, name: ' Test Traveller '});
  assert.equal(replay.token, created.token);
  assert.equal((await server.byToken(created.token)).guests, 2);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 1);
  const key = crypto.randomUUID();
  const results = await Promise.allSettled([
    server.createTravelRequest(guestRequest(), requestInput(undefined, {idempotencyKey: key, contact: 'one@example.test'})),
    server.createTravelRequest(guestRequest(), requestInput(undefined, {idempotencyKey: key, contact: 'two@example.test'})),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 2);
});

test('idempotency prevents duplicate creation, including simultaneous submissions', async t => {
  const db = world(t);
  const input = requestInput();
  const results = await Promise.all([
    server.createTravelRequest(guestRequest(), input), server.createTravelRequest(guestRequest(), input),
  ]);
  assert.equal(results[0].token, results[1].token);
  assert.equal(results[0].reference, results[1].reference);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 1);
  await assert.rejects(server.createTravelRequest(guestRequest(), {...input, idempotencyKey: crypto.randomUUID()}), isError(409, /matching request/));
  await server.mutateAdmin(ownerRequest(), {action: 'saveService', service: service('tour', 'tour', {published: false})});
  const replay = await server.createTravelRequest(guestRequest(), input);
  assert.equal(replay.token, results[0].token);
});

test('website rate limits stop request flooding and permit a later hour without storing raw IP addresses', async t => {
  const db = world(t);
  const submit = i => server.createTravelRequest(new Request(ORIGIN + '/api/requests', {
    method: 'POST', headers: {origin: ORIGIN, 'cf-connecting-ip': '192.0.2.10'},
  }), requestInput(undefined, {contact: `traveller${i}@example.test`}));
  for (let i = 0; i < 20; i++) await submit(i);
  await assert.rejects(submit(20), isError(429));
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 20);
  const limits = db.sqlite.prepare('SELECT key,count FROM rate_limits').all();
  assert.equal(limits.length, 1);
  assert.equal(limits[0].count, 21);
  assert.match(limits[0].key, /^[a-f0-9]{64}:\d+$/);
  t.mock.timers.setTime(CLOCK + 3600000);
  await submit(21);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 21);
});

test('the SQL primary key rejects double claims and an entire D1 batch rolls back', async t => {
  const db = world(t);
  await db.prepare('INSERT INTO reservations (resource_id,slot,unit,request_id) VALUES (?,?,?,?)').bind('guide', 'time:one', 1, 'existing').run();
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO blocks (id,data) VALUES (?,?)').bind('attempted-block', '{}'),
    db.prepare('INSERT INTO reservations (resource_id,slot,unit,request_id) VALUES (?,?,?,?)').bind('room', 'night:2030-10-12', 1, 'attempted-block'),
    db.prepare('INSERT INTO reservations (resource_id,slot,unit,request_id) VALUES (?,?,?,?)').bind('guide', 'time:one', 1, 'attempted-block'),
  ]), /UNIQUE constraint/);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM blocks').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations').get().n, 1);
});
