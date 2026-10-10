import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceClaims, quoteClaims } from '../app/lib/domain.ts';
import { resource, service, quoteItem, quotedRequest, freezeClock } from './fixtures.mjs';

const commonSlots = (a, b) => {
  const keys = new Set(a.map(c => c.resourceId + '|' + c.slot));
  return b.filter(c => keys.has(c.resourceId + '|' + c.slot));
};

test('a room is occupied by night, overlaps existing nights, and is free after checkout', () => {
  const room = resource('room', 'room', {capacity: 3});
  const first = resourceClaims(room, '2030-10-12T15:00:00+04:00', '2030-10-15T11:00:00+04:00', 2);
  assert.deepEqual(first.map(c => c.slot), ['night:2030-10-12', 'night:2030-10-13', 'night:2030-10-14']);
  assert.ok(first.every(c => c.units === 1 && c.capacity === 1));
  const overlap = resourceClaims(room, '2030-10-14T15:00:00+04:00', '2030-10-16T11:00:00+04:00');
  assert.equal(commonSlots(first, overlap).length, 1);
  const afterCheckout = resourceClaims(room, '2030-10-15T15:00:00+04:00', '2030-10-16T11:00:00+04:00');
  assert.equal(commonSlots(first, afterCheckout).length, 0);
});

test('guides and shared vehicles include travel buffers in their conflicting slots', () => {
  for (const kind of ['guide', 'vehicle', 'driver']) {
    const res = resource(kind, kind, {bufferMinutes: 30});
    const first = resourceClaims(res, '2030-10-12T10:00:00+04:00', '2030-10-12T12:00:00+04:00');
    const tooClose = resourceClaims(res, '2030-10-12T12:30:00+04:00', '2030-10-12T13:30:00+04:00');
    assert.ok(commonSlots(first, tooClose).length > 0, kind);
    const enoughTravelTime = resourceClaims(res, '2030-10-12T13:00:00+04:00', '2030-10-12T14:00:00+04:00');
    assert.equal(commonSlots(first, enoughTravelTime).length, 0, kind);
  }
});

test('a paused resource and invalid or excessive intervals cannot be reserved', () => {
  assert.throws(() => resourceClaims(resource('guide', 'guide', {active: false}), '2030-10-12T10:00Z', '2030-10-12T12:00Z'), /paused/);
  assert.throws(() => resourceClaims(resource('guide', 'guide'), '2030-10-12T10:00Z', '2030-10-12T10:00Z'), /Invalid resource interval/);
  assert.throws(() => resourceClaims(resource('guide', 'guide'), 'invalid', '2030-10-12T10:00Z'), /Invalid resource interval/);
  assert.throws(() => resourceClaims(resource('guide', 'guide'), '2030-10-12T10:00Z', '2030-11-13T10:00Z'), /31 days/);
  assert.throws(() => resourceClaims(resource('room', 'room'), '2030-10-12T10:00Z', '2030-10-12T14:00Z'), /at least one night/);
});

test('multiple items cannot silently double-book the same guide or travel buffer', t => {
  freezeClock(t);
  const r = quotedRequest([service('a', 'tour'), service('b', 'tour')], [
    quoteItem('a'), quoteItem('b', {start: '2030-10-12T12:30:00+04:00', end: '2030-10-12T13:30:00+04:00'}),
  ]);
  assert.throws(() => quoteClaims(r, [resource('guide', 'guide', {bufferMinutes: 30})]), /Two items.*overlap/);
  r.quote.items[1].start = '2030-10-12T13:00:00+04:00';
  r.quote.items[1].end = '2030-10-12T14:00:00+04:00';
  assert.doesNotThrow(() => quoteClaims(r, [resource('guide', 'guide', {bufferMinutes: 30})]));
});

test('stay occupancy and tours require suitable assigned resources', t => {
  freezeClock(t);
  const stay = quotedRequest([service('stay', 'stay')], [quoteItem('stay', {
    resourceIds: ['room'], start: '2030-10-12T15:00:00+04:00', end: '2030-10-15T11:00:00+04:00',
  })]);
  assert.throws(() => quoteClaims(stay, [resource('room', 'room', {capacity: 1})]), /enough room occupancy/);
  assert.doesNotThrow(() => quoteClaims(stay, [resource('room', 'room', {capacity: 2})]));
  assert.throws(() => quoteClaims(quotedRequest(), [resource('guide', 'vehicle')]), /Assign a guide/);
  assert.throws(() => quoteClaims(quotedRequest(), []), /resource no longer exists/);
});

test('taxi confirmation needs accepted driver evidence and an active vehicle with enough passenger seats', t => {
  freezeClock(t);
  const r = quotedRequest([service('taxi', 'taxi')], [quoteItem('taxi', {resourceIds: []})]);
  const resources = [resource('driver', 'driver'), resource('vehicle', 'vehicle', {capacity: 2})];
  assert.throws(() => quoteClaims(r, resources), /driver must accept/);
  r.dispatch = {status: 'accepted', driverId: 'driver', vehicleId: 'vehicle', evidence: ''};
  assert.throws(() => quoteClaims(r, resources), /driver must accept/);
  r.dispatch.evidence = 'Driver accepted the offered fare and timing by telephone.';
  const claims = quoteClaims(r, resources);
  assert.deepEqual([...new Set(claims.map(c => c.resourceId))].sort(), ['driver', 'vehicle']);
  assert.throws(() => quoteClaims(r, [resources[0], {...resources[1], capacity: 1}]), /cannot carry all guests/);
  assert.throws(() => quoteClaims(r, [{...resources[0], active: false}, resources[1]]), /active driver and vehicle/);
  r.dispatch.status = 'offered';
  assert.throws(() => quoteClaims(r, resources), /driver must accept/);
});

test('departure inventory carries the exact guest count and rejects excess capacity', t => {
  freezeClock(t);
  const departure = resource('departure', 'departure', {capacity: 4});
  const r = quotedRequest([service('tour', 'tour')], [quoteItem('tour', {resourceIds: ['guide', 'departure']})]);
  const claims = quoteClaims(r, [resource('guide', 'guide'), departure]).filter(c => c.resourceId === 'departure');
  assert.ok(claims.length > 0);
  assert.ok(claims.every(c => c.units === 2 && c.capacity === 4));
  r.quote.items[0].units = 1;
  assert.throws(() => quoteClaims(r, [resource('guide', 'guide'), departure]), /seats must equal the guest count/);
  r.quote.items[0].units = 2;
  assert.throws(() => quoteClaims(r, [resource('guide', 'guide'), {...departure, capacity: 1}]), /enough capacity/);
});
