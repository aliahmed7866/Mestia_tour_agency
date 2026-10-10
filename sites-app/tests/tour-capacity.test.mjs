import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { SQLiteD1 } from './sqlite-d1.mjs';
import { SETTINGS, CLOCK, service, resource, requestInput, quotedRequest, quoteInput, quoteItem, freezeClock } from './fixtures.mjs';
import { quoteClaims } from '../app/lib/domain.ts';

globalThis.__mestiaTestEnv = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') return {url: 'mestia-test:tour-env', shortCircuit: true};
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const candidate = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(candidate)) return {url: candidate.href, shortCircuit: true};
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'mestia-test:tour-env') return {
      format: 'module', source: 'export const env = globalThis.__mestiaTestEnv;', shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const server = await import('../app/lib/server.ts');

const ORIGIN = 'https://mestia.test';
const owner = (id = 'owner') => new Request(ORIGIN + '/api/admin', {
  method: 'POST', headers: {origin: ORIGIN, 'oai-authenticated-user-id': id},
});
const guest = () => new Request(ORIGIN + '/api/request', {method: 'POST', headers: {origin: ORIGIN}});
const isError = status => error => error.status === status;
const invalid = error => error.status === 400 || error.status === 409 || error.name === 'ZodError';
const inventoryResources = () => [
  resource('guide-a', 'guide'), resource('guide-b', 'guide'), resource('guide-c', 'guide'),
  resource('vehicle-a', 'vehicle', {capacity: 8}), resource('vehicle-b', 'vehicle', {capacity: 8}),
  resource('driver-a', 'driver'), resource('room', 'room', {capacity: 4}),
];
const inventoryServices = () => [service('tour', 'tour'), service('other-tour', 'tour'), service('stay', 'stay'), service('taxi', 'taxi')];

function world(t, resources = inventoryResources(), services = inventoryServices()) {
  freezeClock(t);
  const db = new SQLiteD1();
  globalThis.__mestiaTestEnv.DB = db;
  db.sqlite.prepare('INSERT INTO settings (id,data) VALUES (?,?)').run('business', JSON.stringify({...SETTINGS, adminUserId: 'owner'}));
  for (const s of services) db.sqlite.prepare('INSERT INTO services (id,data) VALUES (?,?)').run(s.id, JSON.stringify(s));
  for (const r of resources) db.sqlite.prepare('INSERT INTO resources (id,data) VALUES (?,?)').run(r.id, JSON.stringify(r));
  t.after(() => db.close());
  return db;
}

function departure(overrides = {}) {
  return {
    id: crypto.randomUUID(), serviceId: 'tour',
    start: '2030-10-12T10:00:00+04:00', end: '2030-10-12T12:00:00+04:00',
    capacity: 4, guideId: 'guide-a', vehicleId: '', status: 'open', version: 0,
    ...overrides,
  };
}

async function saveDeparture(d) {
  await server.mutateAdmin(owner(), {action: 'saveDeparture', departure: d});
  return (await server.adminData(owner())).departures.find(row => row.id === d.id);
}

const setLimit = maxConcurrentTours => server.mutateAdmin(owner(), {action: 'setTourLimit', maxConcurrentTours});
const confirm = r => server.mutateAdmin(owner(), {action: 'confirm', requestId: r.id});
const cancel = r => server.mutateAdmin(owner(), {action: 'cancel', requestId: r.id, reason: 'Guest changed travel plans'});
const reservations = (db, ownerId) => db.sqlite.prepare('SELECT resource_id,slot,unit,request_id FROM reservations WHERE request_id=? ORDER BY resource_id,slot,unit').all(ownerId);
const allReservations = db => db.sqlite.prepare('SELECT resource_id,slot,unit,request_id FROM reservations ORDER BY resource_id,slot,unit').all();
const seatRows = (db, d) => db.sqlite.prepare('SELECT request_id,unit,slot FROM reservations WHERE resource_id=? ORDER BY unit,request_id').all('tour-seat:' + d.id);

function insertRequest(db, r) {
  db.sqlite.prepare('INSERT INTO requests (id,token,idempotency,data,version) VALUES (?,?,?,?,?)')
    .run(r.id, r.token, crypto.randomUUID(), JSON.stringify(r), r.version);
  return r;
}

function sharedBooking(db, d, guests = 2, overrides = {}) {
  const item = quoteItem(d.serviceId, {departureId: d.id, resourceIds: [], units: guests, start: d.start, end: d.end});
  const r = quotedRequest([service(d.serviceId, 'tour')], [item], {guests, ...overrides});
  r.items[0].date = new Date(Date.parse(d.start) + 4 * 3600000).toISOString().slice(0, 10);
  r.items[0].departureId = d.id;
  r.quote.acceptedAt = new Date(CLOCK).toISOString();
  r.contactVerified = true;
  return insertRequest(db, r);
}

function privateBooking(db, guideId = 'guide-b', overrides = {}) {
  const r = quotedRequest([service('tour', 'tour')], [quoteItem('tour', {resourceIds: [guideId]})], overrides);
  r.quote.acceptedAt = new Date(CLOCK).toISOString();
  r.contactVerified = true;
  return insertRequest(db, r);
}

test('tour inventory defaults conservatively and only the owner can change its limit or departures', async t => {
  world(t);
  assert.equal((await server.adminData(owner())).tourInventory.maxConcurrentTours, 1);
  for (const id of ['', 'another-user']) {
    for (const input of [
      {action: 'setTourLimit', maxConcurrentTours: 2},
      {action: 'saveDeparture', departure: departure()},
    ]) await assert.rejects(server.mutateAdmin(owner(id), input), isError(id ? 403 : 401));
  }
  await setLimit(20);
  assert.equal((await server.adminData(owner())).tourInventory.maxConcurrentTours, 20);
  for (const maxConcurrentTours of [0, 21, 1.5, '2']) await assert.rejects(setLimit(maxConcurrentTours), invalid);
  assert.equal((await server.adminData(owner())).tourInventory.maxConcurrentTours, 20);
});

test('a scheduled tour reserves its guide and optional vehicle once and exposes exact available seats', async t => {
  const db = world(t);
  const d = await saveDeparture(departure({capacity: 5, vehicleId: 'vehicle-a'}));
  assert.equal(d.bookedSeats, 0);
  assert.equal(d.remainingSeats, 5);
  const schedule = reservations(db, 'tour-schedule:' + d.id);
  assert.deepEqual([...new Set(schedule.map(row => row.resource_id))].sort(), ['__tour_parallel__', 'guide-a', 'vehicle-a']);
  assert.ok(schedule.length > 0);
  assert.ok(schedule.every(row => row.unit === 1));
  assert.equal(seatRows(db, d).length, 0);
  const a = sharedBooking(db, d, 2), b = sharedBooking(db, d, 3);
  await confirm(a);
  await confirm(b);
  assert.deepEqual(reservations(db, 'tour-schedule:' + d.id), schedule);
  for (const r of [a, b]) assert.deepEqual([...new Set(reservations(db, r.id).map(row => row.resource_id))], ['tour-seat:' + d.id]);
  const latest = (await server.adminData(owner())).departures.find(row => row.id === d.id);
  assert.equal(latest.bookedSeats, 5);
  assert.equal(latest.remainingSeats, 0);
  const c = sharedBooking(db, d, 1);
  await assert.rejects(confirm(c), isError(409));
  assert.equal((await server.getTravelRequest(c.id)).status, 'enquiry');
  assert.equal(reservations(db, c.id).length, 0);
});

test('scheduled tour validation rejects invalid capacity, intervals and unsuitable assigned resources without reservations', async t => {
  const db = world(t);
  const bad = [
    {capacity: 0}, {capacity: 51}, {capacity: 1.5}, {end: '2030-10-12T09:00:00+04:00'},
    {serviceId: 'missing'}, {serviceId: 'stay'}, {guideId: 'missing'}, {guideId: 'driver-a'},
    {vehicleId: 'driver-a'}, {capacity: 9, vehicleId: 'vehicle-a'},
    {status: 'cancelled', end: '2030-10-12T09:00:00+04:00'},
    {status: 'cancelled', end: '2030-10-20T10:00:00+04:00'},
  ];
  for (const changes of bad) await assert.rejects(saveDeparture(departure(changes)), invalid);
  assert.equal(allReservations(db).length, 0);
  assert.deepEqual((await server.adminData(owner())).departures, []);
  await server.mutateAdmin(owner(), {action: 'saveResource', resource: resource('guide-a', 'guide', {active: false})});
  await assert.rejects(saveDeparture(departure()), invalid);
  assert.equal(allReservations(db).length, 0);
});

test('two groups racing for the final scheduled-tour seat commit only one complete booking', async t => {
  const db = world(t);
  const d = await saveDeparture(departure({capacity: 3}));
  await confirm(sharedBooking(db, d, 2));
  const a = sharedBooking(db, d, 1), b = sharedBooking(db, d, 1);
  const results = await Promise.allSettled([confirm(a), confirm(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  const records = await Promise.all([a, b].map(r => server.getTravelRequest(r.id)));
  const loser = records.find(r => r.status === 'enquiry');
  assert.ok(loser);
  assert.equal(loser.version, 0);
  assert.equal(reservations(db, loser.id).length, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations WHERE key=?').get(loser.id + ':v0').n, 0);
  assert.equal((await server.adminData(owner())).departures[0].bookedSeats, 3);
});

test('cancellation releases a group’s seats while retaining the departure and repeating confirmation cannot duplicate capacity', async t => {
  const db = world(t);
  const d = await saveDeparture(departure({capacity: 4}));
  const a = sharedBooking(db, d, 2), b = sharedBooking(db, d, 2);
  await confirm(a); await confirm(b);
  const before = reservations(db, b.id);
  await assert.rejects(confirm(b), invalid);
  assert.deepEqual(reservations(db, b.id), before);
  const schedule = reservations(db, 'tour-schedule:' + d.id);
  await cancel(a);
  assert.equal(reservations(db, a.id).length, 0);
  assert.deepEqual(reservations(db, 'tour-schedule:' + d.id), schedule);
  assert.equal((await server.adminData(owner())).departures[0].remainingSeats, 2);
  await confirm(sharedBooking(db, d, 2));
  assert.equal((await server.adminData(owner())).departures[0].bookedSeats, 4);
});

test('quoted tour service identity, seat count and timing must match the actual departure', async t => {
  const db = world(t);
  const d = await saveDeparture(departure());
  const valid = sharedBooking(db, d);
  const resources = await server.getResources();
  const claims = quoteClaims(valid, resources, [d], 1);
  assert.deepEqual(claims, [{resourceId: 'tour-seat:' + d.id, slot: 'seats', units: 2, capacity: 4}]);
  const mutations = [
    r => { r.quote.items[0].departureId = crypto.randomUUID(); },
    r => { r.quote.items[0].start = '2030-10-12T11:00:00+04:00'; },
    r => { r.quote.items[0].end = '2030-10-12T13:00:00+04:00'; },
    r => { r.quote.items[0].units = 1; },
    r => { r.serviceSnapshots[0].id = 'other-tour'; r.items[0].serviceId = 'other-tour'; r.quote.items[0].serviceId = 'other-tour'; },
  ];
  for (const mutate of mutations) {
    const r = structuredClone(valid); mutate(r);
    assert.throws(() => quoteClaims(r, resources, [d], 1), invalid);
  }
  assert.equal(seatRows(db, d).length, 0);
});

test('request creation rejects an unknown, mismatched or closed departure before saving a guest request', async t => {
  const db = world(t);
  let d = await saveDeparture(departure());
  const submit = (changes = {}) => server.createTravelRequest(guest(), requestInput([
    {serviceId: d.serviceId, date: '2030-10-12', departureId: d.id, ...changes},
  ]));
  await assert.rejects(submit({departureId: crypto.randomUUID()}), invalid);
  await assert.rejects(submit({date: '2030-10-13'}), invalid);
  await assert.rejects(submit({serviceId: 'other-tour'}), invalid);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 0);
  const created = await submit();
  const stored = await server.byToken(created.token);
  assert.equal(stored.items[0].departureId, d.id);
  d = await saveDeparture({...d, status: 'closed'});
  await assert.rejects(submit(), invalid);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM requests').get().n, 1);
});

test('closing a departure keeps confirmed guests and resource commitments but blocks later confirmations', async t => {
  const db = world(t);
  let d = await saveDeparture(departure());
  const a = sharedBooking(db, d), pending = sharedBooking(db, d, 1);
  await confirm(a);
  const before = allReservations(db);
  d = await saveDeparture({...d, status: 'closed'});
  assert.equal(d.status, 'closed');
  assert.equal(d.bookedSeats, 2);
  assert.deepEqual(allReservations(db), before);
  await assert.rejects(confirm(pending), invalid);
  assert.equal(reservations(db, pending.id).length, 0);
  d = await saveDeparture({...d, status: 'open'});
  await confirm(pending);
  assert.equal((await server.adminData(owner())).departures[0].bookedSeats, 3);
});

test('tour parallel limit applies to scheduled and private tours across different guides', async t => {
  const db = world(t);
  const d = await saveDeparture(departure());
  await assert.rejects(saveDeparture(departure({guideId: 'guide-b'})), isError(409));
  const privateTour = privateBooking(db, 'guide-b');
  await assert.rejects(confirm(privateTour), isError(409));
  await setLimit(2);
  await confirm(privateTour);
  const third = privateBooking(db, 'guide-c');
  await assert.rejects(confirm(third), isError(409));
  assert.equal((await server.getTravelRequest(third.id)).status, 'enquiry');
  await assert.rejects(setLimit(1), isError(409));
  assert.equal((await server.adminData(owner())).tourInventory.maxConcurrentTours, 2);
  assert.equal((await server.adminData(owner())).departures.find(row => row.id === d.id).capacity, d.capacity);
});

test('a named guide remains exclusive and travel buffers apply even when parallel tours are allowed', async t => {
  const db = world(t, inventoryResources().map(r => r.id === 'guide-a' ? {...r, bufferMinutes: 30} : r));
  await setLimit(3);
  const d = await saveDeparture(departure());
  await assert.rejects(saveDeparture(departure({guideId: 'guide-a', serviceId: 'other-tour'})), isError(409));
  await assert.rejects(confirm(privateBooking(db, 'guide-a')), isError(409));
  await assert.rejects(saveDeparture(departure({start: '2030-10-12T12:30:00+04:00', end: '2030-10-12T14:00:00+04:00'})), isError(409));
  await saveDeparture(departure({start: '2030-10-12T13:00:00+04:00', end: '2030-10-12T14:00:00+04:00'}));
  assert.equal((await server.adminData(owner())).departures.length, 2);
  assert.ok(reservations(db, 'tour-schedule:' + d.id).some(row => row.resource_id === 'guide-a'));
});

test('scheduled-tour vehicles conflict with taxi dispatch and blocks are respected before a departure is saved', async t => {
  const db = world(t);
  await setLimit(2);
  await server.mutateAdmin(owner(), {action: 'block', resourceId: 'guide-a', start: departure().start, end: departure().end, reason: 'Guide unavailable'});
  await assert.rejects(saveDeparture(departure()), isError(409));
  const block = (await server.adminData(owner())).blocks[0];
  await server.mutateAdmin(owner(), {action: 'unblock', blockId: block.id});
  await saveDeparture(departure({vehicleId: 'vehicle-a'}));
  const taxi = quotedRequest([service('taxi', 'taxi')], [quoteItem('taxi', {resourceIds: []})], {
    dispatch: {status: 'accepted', driverId: 'driver-a', vehicleId: 'vehicle-a', evidence: 'Driver accepted by telephone'},
  });
  taxi.quote.acceptedAt = new Date(CLOCK).toISOString(); taxi.contactVerified = true; insertRequest(db, taxi);
  await assert.rejects(confirm(taxi), isError(409));
  assert.equal(reservations(db, taxi.id).length, 0);
});

test('capacity can increase without altering accepted prices and cannot shrink below confirmed guests', async t => {
  const db = world(t);
  let d = await saveDeparture(departure({capacity: 4}));
  const a = sharedBooking(db, d, 3); await confirm(a);
  const before = await server.getTravelRequest(a.id);
  d = await saveDeparture({...d, capacity: 6});
  assert.equal(d.capacity, 6);
  assert.equal(d.remainingSeats, 3);
  assert.deepEqual(await server.getTravelRequest(a.id), before);
  const reservationsBefore = allReservations(db);
  await assert.rejects(saveDeparture({...d, capacity: 2}), isError(409));
  assert.deepEqual(allReservations(db), reservationsBefore);
  assert.equal((await server.adminData(owner())).departures[0].capacity, 6);
});

test('shrinking capacity repacks confirmed seat allocations after cancellation leaves high numbered seats', async t => {
  const db = world(t);
  let d = await saveDeparture(departure({capacity: 6}));
  const a = sharedBooking(db, d, 2), b = sharedBooking(db, d, 2), c = sharedBooking(db, d, 2);
  await confirm(a); await confirm(b); await confirm(c); await cancel(a); await cancel(b);
  assert.deepEqual(seatRows(db, d).map(row => row.unit), [5, 6]);
  const before = await server.getTravelRequest(c.id);
  d = await saveDeparture({...d, capacity: 3});
  assert.deepEqual(seatRows(db, d).map(row => row.unit), [1, 2]);
  assert.deepEqual(await server.getTravelRequest(c.id), before);
  await confirm(sharedBooking(db, d, 1));
  assert.deepEqual(seatRows(db, d).map(row => row.unit), [1, 2, 3]);
  assert.equal((await server.adminData(owner())).departures[0].remainingSeats, 0);
});

test('confirmed guests prevent moving, replacing resources, changing service or cancelling the departure', async t => {
  const db = world(t);
  const d = await saveDeparture(departure({vehicleId: 'vehicle-a'}));
  await confirm(sharedBooking(db, d));
  const before = allReservations(db);
  for (const changes of [
    {start: '2030-10-12T11:00:00+04:00'}, {end: '2030-10-12T13:00:00+04:00'},
    {guideId: 'guide-b'}, {vehicleId: 'vehicle-b'}, {serviceId: 'other-tour'}, {status: 'cancelled'},
  ]) {
    await assert.rejects(saveDeparture({...d, ...changes}), isError(409));
    assert.deepEqual(allReservations(db), before);
  }
  assert.equal((await server.adminData(owner())).departures[0].status, 'open');
});

test('empty departure edits reserve the replacement atomically and cancellation releases all commitments', async t => {
  const db = world(t);
  await setLimit(2);
  let a = await saveDeparture(departure());
  await saveDeparture(departure({guideId: 'guide-b'}));
  const before = allReservations(db);
  await assert.rejects(saveDeparture({...a, guideId: 'guide-b'}), isError(409));
  assert.deepEqual(allReservations(db), before);
  for (let capacity = 5; capacity <= 7; capacity++) a = await saveDeparture({...a, capacity});
  const rows = reservations(db, 'tour-schedule:' + a.id);
  assert.equal(rows.length, before.filter(row => row.request_id === 'tour-schedule:' + a.id).length);
  a = await saveDeparture({...a, start: '2030-10-12T14:00:00+04:00', end: '2030-10-12T16:00:00+04:00'});
  assert.ok(reservations(db, 'tour-schedule:' + a.id).filter(row => row.resource_id === 'guide-a').every(row => Number(row.slot.slice(5)) >= Date.parse(a.start)));
  a = await saveDeparture({...a, status: 'cancelled'});
  assert.equal(reservations(db, 'tour-schedule:' + a.id).length, 0);
  assert.equal(a.status, 'cancelled');
});

test('lowering simultaneous-tour capacity compacts allocation holes for scheduled and private commitments', async t => {
  const db = world(t);
  await setLimit(3);
  let a = await saveDeparture(departure());
  let b = await saveDeparture(departure({guideId: 'guide-b'}));
  const c = privateBooking(db, 'guide-c'); await confirm(c);
  assert.ok(reservations(db, c.id).filter(row => row.resource_id === '__tour_parallel__').every(row => row.unit === 3));
  a = await saveDeparture({...a, status: 'cancelled'});
  b = await saveDeparture({...b, status: 'cancelled'});
  const before = await server.getTravelRequest(c.id);
  await setLimit(2);
  assert.ok(reservations(db, c.id).filter(row => row.resource_id === '__tour_parallel__').every(row => row.unit === 1));
  assert.deepEqual(await server.getTravelRequest(c.id), before);
  await saveDeparture(departure({guideId: 'guide-a'}));
  await assert.rejects(saveDeparture(departure({guideId: 'guide-b'})), isError(409));
  assert.equal((await server.adminData(owner())).tourInventory.maxConcurrentTours, 2);
});

test('simultaneous departure edits use versions so a stale configuration cannot overwrite a saved change', async t => {
  world(t);
  const d = await saveDeparture(departure());
  const changes = await Promise.allSettled([
    saveDeparture({...d, capacity: 5}), saveDeparture({...d, capacity: 6}),
  ]);
  assert.equal(changes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(changes.find(result => result.status === 'rejected').reason.status, 409);
  const latest = (await server.adminData(owner())).departures[0];
  assert.ok([5, 6].includes(latest.capacity));
  assert.equal(latest.version, d.version + 1);
  await assert.rejects(saveDeparture({...d, capacity: 7}), isError(409));
});

test('a capacity reduction racing confirmation never commits more guests than the saved departure permits', async t => {
  const db = world(t);
  const d = await saveDeparture(departure({capacity: 4}));
  const booking = sharedBooking(db, d, 2);
  const results = await Promise.allSettled([confirm(booking), saveDeparture({...d, capacity: 1})]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const latest = (await server.adminData(owner())).departures[0];
  const request = await server.getTravelRequest(booking.id);
  assert.ok(latest.bookedSeats <= latest.capacity);
  if (request.status === 'confirmed') {
    assert.equal(latest.capacity, 4);
    assert.equal(latest.bookedSeats, 2);
  } else {
    assert.equal(latest.capacity, 1);
    assert.equal(latest.bookedSeats, 0);
    assert.equal(reservations(db, booking.id).length, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations WHERE key=?').get(booking.id + ':v0').n, 0);
  }
});

test('simultaneous new departures cannot both reserve the same guide even with spare parallel-tour capacity', async t => {
  const db = world(t);
  await setLimit(2);
  const a = departure(), b = departure({serviceId: 'other-tour'});
  const results = await Promise.allSettled([saveDeparture(a), saveDeparture(b)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal((await server.adminData(owner())).departures.length, 1);
  const loser = results[0].status === 'rejected' ? a : b;
  assert.equal(reservations(db, 'tour-schedule:' + loser.id).length, 0);
});

test('taxi reassignment in a confirmed package preserves shared departure seats even after sales close', async t => {
  const db = world(t, [...inventoryResources(), resource('driver-b', 'driver')]);
  let d = await saveDeparture(departure());
  const services = [service('stay', 'stay'), service('tour', 'tour'), service('taxi', 'taxi')];
  const items = [
    quoteItem('stay', {resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00'}),
    quoteItem('tour', {departureId: d.id, resourceIds: [], start: d.start, end: d.end}),
    quoteItem('taxi', {resourceIds: []}),
  ];
  const r = quotedRequest(services, items, {
    dispatch: {status: 'accepted', driverId: 'driver-a', vehicleId: 'vehicle-a', evidence: 'Driver accepted by telephone'},
  });
  r.items.find(item => item.serviceId === 'tour').departureId = d.id;
  r.quote.acceptedAt = new Date(CLOCK).toISOString(); r.contactVerified = true; insertRequest(db, r);
  await confirm(r);
  const confirmed = await server.getTravelRequest(r.id);
  const preserved = reservations(db, r.id).filter(row => row.resource_id === 'room' || row.resource_id === 'tour-seat:' + d.id);
  d = await saveDeparture({...d, status: 'closed'});
  const dispatch = {
    action: 'dispatch', requestId: r.id, driverId: 'driver-b', vehicleId: 'vehicle-b', evidence: 'Replacement driver accepted by telephone',
  };
  await server.mutateAdmin(owner(), {...dispatch, status: 'offered'});
  assert.deepEqual(reservations(db, r.id), preserved);
  await server.mutateAdmin(owner(), {...dispatch, status: 'accepted'});
  assert.deepEqual(reservations(db, r.id).filter(row => row.resource_id === 'room' || row.resource_id === 'tour-seat:' + d.id), preserved);
  assert.deepEqual([...new Set(reservations(db, r.id).map(row => row.resource_id))].sort(), ['driver-b', 'room', 'tour-seat:' + d.id, 'vehicle-b'].sort());
  const latest = await server.getTravelRequest(r.id);
  assert.equal(latest.quote.total, confirmed.quote.total);
  assert.equal(latest.quote.acceptedAt, confirmed.quote.acceptedAt);
  assert.equal((await server.adminData(owner())).departures[0].bookedSeats, 2);
});

test('existing private tours are counted once when inventory limits are introduced and accepted bookings stay unchanged', async t => {
  const db = world(t);
  const legacy = ['guide-a', 'guide-b'].map(guideId => {
    const r = privateBooking(db, guideId);
    r.status = 'confirmed';
    db.sqlite.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id);
    for (const claim of quoteClaims(r, inventoryResources()).filter(c => c.resourceId !== '__tour_parallel__')) {
      db.sqlite.prepare('INSERT INTO reservations (resource_id,slot,unit,request_id) VALUES (?,?,?,?)')
        .run(claim.resourceId, claim.slot, 1, r.id);
    }
    return r;
  });
  const snapshots = await Promise.all(legacy.map(r => server.getTravelRequest(r.id)));
  await assert.rejects(setLimit(1), isError(409));
  await setLimit(2);
  const before = allReservations(db);
  await setLimit(2);
  assert.deepEqual(allReservations(db), before);
  assert.deepEqual(await Promise.all(legacy.map(r => server.getTravelRequest(r.id))), snapshots);
  const slots = db.sqlite.prepare('SELECT slot,count(*) n FROM reservations WHERE resource_id=? GROUP BY slot').all('__tour_parallel__');
  assert.ok(slots.length > 0);
  assert.ok(slots.every(row => row.n === 2));
  await assert.rejects(confirm(privateBooking(db, 'guide-c')), isError(409));
});

test('seven-day departures reserve every guide, vehicle and tour slot using bounded SQL batches', async t => {
  const db = world(t);
  const batchSizes = [];
  const originalBatch = db.batch.bind(db);
  db.batch = async statements => {batchSizes.push(statements.length); return originalBatch(statements);};
  let d = await saveDeparture(departure({vehicleId: 'vehicle-a', end: '2030-10-19T10:00:00+04:00'}));
  const rows = reservations(db, 'tour-schedule:' + d.id);
  assert.equal(rows.length, 7 * 24 * 4 * 3);
  for (const id of ['guide-a', 'vehicle-a', '__tour_parallel__']) {
    const slots = rows.filter(row => row.resource_id === id);
    assert.equal(slots.length, 672);
    assert.equal(slots[0].slot, 'time:' + Date.parse(d.start));
    assert.equal(slots.at(-1).slot, 'time:' + (Date.parse(d.end) - 900000));
  }
  d = await saveDeparture({...d, capacity: 5});
  assert.deepEqual(reservations(db, 'tour-schedule:' + d.id), rows);
  await setLimit(2);
  assert.deepEqual(reservations(db, 'tour-schedule:' + d.id), rows);
  await confirm(sharedBooking(db, d, 3));
  assert.equal((await server.adminData(owner())).departures[0].bookedSeats, 3);
  assert.ok(batchSizes.every(size => size <= 25), JSON.stringify(batchSizes));
});

test('a conflict in a later reservation chunk rolls back earlier chunks and surrounding writes', async t => {
  const db = world(t);
  const rows = Array.from({length: 401}, (_, i) => ['bulk-resource', 'time:' + i, 1, 'attempted-booking']);
  db.sqlite.prepare('INSERT INTO reservations (resource_id,slot,unit,request_id) VALUES (?,?,?,?)')
    .run('bulk-resource', 'time:400', 1, 'existing-booking');
  const statements = server.reservationInserts(rows);
  assert.equal(statements.length, 3);
  await assert.rejects(db.batch([
    db.prepare('INSERT INTO blocks (id,data) VALUES (?,?)').bind('attempted-block', '{}'),
    ...statements,
  ]), /UNIQUE constraint/);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM blocks').get().n, 0);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM reservations').get().n, 1);
  assert.equal(db.sqlite.prepare('SELECT request_id FROM reservations').get().request_id, 'existing-booking');
});

test('pending tour demand follows the quoted alternative departure while the original request remains recorded', async t => {
  world(t);
  const preferred = await saveDeparture(departure());
  const alternative = await saveDeparture(departure({start: '2030-10-13T10:00:00+04:00', end: '2030-10-13T12:00:00+04:00'}));
  const created = await server.createTravelRequest(guest(), requestInput([
    {serviceId: 'tour', date: '2030-10-12', departureId: preferred.id},
  ]));
  const r = await server.byToken(created.token);
  await assert.rejects(server.mutateAdmin(owner(), {
    action: 'quote', requestId: r.id,
    quote: quoteInput([quoteItem('tour', {departureId: alternative.id, resourceIds: [], units: 1, start: alternative.start, end: alternative.end})]),
  }), isError(400));
  assert.equal((await server.getTravelRequest(r.id)).quote, null);
  await server.mutateAdmin(owner(), {
    action: 'quote', requestId: r.id,
    quote: quoteInput([quoteItem('tour', {departureId: alternative.id, resourceIds: [], start: alternative.start, end: alternative.end})]),
  });
  const data = await server.adminData(owner());
  assert.equal(data.departures.find(d => d.id === preferred.id).requestedSeats, 0);
  assert.equal(data.departures.find(d => d.id === alternative.id).requestedSeats, 2);
  assert.equal((await server.getTravelRequest(r.id)).items[0].departureId, preferred.id);
  assert.equal((await server.getTravelRequest(r.id)).quote.items[0].departureId, alternative.id);
  assert.equal((await server.getTravelRequest(r.id)).quote.acceptedAt, null);
});

test('unaccepted departure quotes cannot be accepted after sales close, cancellation, rescheduling or seats sell out', async t => {
  const db = world(t);
  for (const [index, outcome] of ['closed', 'cancelled', 'rescheduled', 'sold-out'].entries()) {
    const date = '2030-10-' + String(12 + index);
    let d = await saveDeparture(departure({capacity: 2, start: date + 'T10:00:00+04:00', end: date + 'T12:00:00+04:00'}));
    const r = sharedBooking(db, d, 2);
    r.quote.acceptedAt = null;
    db.sqlite.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id);
    if (outcome === 'rescheduled') d = await saveDeparture({...d, start: date + 'T14:00:00+04:00', end: date + 'T16:00:00+04:00'});
    else if (outcome === 'sold-out') await confirm(sharedBooking(db, d, 2));
    else d = await saveDeparture({...d, status: outcome});
    await assert.rejects(server.guestAction(guest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true}), invalid);
    const latest = await server.getTravelRequest(r.id);
    assert.equal(latest.quote.acceptedAt, null);
    assert.equal(latest.version, 0);
    assert.equal(reservations(db, r.id).length, 0);
  }
});

test('a departure closure or sold-out race before acceptance commits rolls back the obsolete acceptance', async t => {
  const db = world(t);
  for (const [index, outcome] of ['close', 'fill'].entries()) {
    const date = '2030-10-' + String(12 + index);
    const d = await saveDeparture(departure({capacity: 2, start: date + 'T10:00:00+04:00', end: date + 'T12:00:00+04:00'}));
    const r = sharedBooking(db, d, 2);
    r.quote.acceptedAt = null;
    db.sqlite.prepare('UPDATE requests SET data=? WHERE id=?').run(JSON.stringify(r), r.id);
    const originalBatch = db.batch.bind(db);
    let arrived, resume, held = false;
    const atCommit = new Promise(resolve => {arrived = resolve;});
    const released = new Promise(resolve => {resume = resolve;});
    db.batch = async statements => {
      if (!held) {held = true; arrived(); await released;}
      return originalBatch(statements);
    };
    const acceptance = server.guestAction(guest(), {action: 'accept', token: r.token, quoteId: r.quote.id, acceptTerms: true});
    await atCommit;
    if (outcome === 'close') await saveDeparture({...d, status: 'closed'});
    else await confirm(sharedBooking(db, d, 2));
    resume();
    await assert.rejects(acceptance, isError(409));
    db.batch = originalBatch;
    const latest = await server.getTravelRequest(r.id);
    assert.equal(latest.quote.acceptedAt, null);
    assert.equal(latest.version, 0);
    assert.equal(reservations(db, r.id).length, 0);
    assert.equal(db.sqlite.prepare('SELECT count(*) n FROM operations WHERE key=?').get(r.id + ':v0').n, 0);
  }
});
