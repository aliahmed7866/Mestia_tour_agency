import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshSelections } from '../app/lib/catalogue-selection.ts';

const now = Date.parse('2026-11-01T05:00:00Z');
const service = { id: 'tour', published: true };
const item = { serviceId: 'tour', departureId: 'departure', date: '2026-11-02', time: '09:00' };
const departure = { id: 'departure', serviceId: 'tour', start: '2026-11-02T09:00:00+04:00', status: 'open' };

test('unpublished selections remain present for explicit removal, with their requested details intact', () => {
  const selection = refreshSelections([item], [{ ...service, published: false }], [], now);
  assert.deepEqual(selection.items, [item]);
  assert.deepEqual(selection.unavailable, [item]);
  assert.equal(selection.changed.length, 0);
});

test('a departure moved to another tour must be chosen again even when its time is unchanged', () => {
  const otherItem = { serviceId: 'stay', date: '2026-11-03', endDate: '2026-11-05' };
  const selection = refreshSelections([item, otherItem], [service, { id: 'stay', published: true }], [{ ...departure, serviceId: 'other-tour' }], now);
  assert.deepEqual(selection.changed, [item]);
  assert.deepEqual(selection.items, [{ serviceId: 'tour', date: '' }, otherItem]);
  assert.deepEqual(item, { serviceId: 'tour', departureId: 'departure', date: '2026-11-02', time: '09:00' });
});

test('valid selections survive refresh while closed, changed and started departures reset only their dates', () => {
  assert.deepEqual(refreshSelections([item], [service], [departure], now).items, [item]);
  for (const altered of [{ ...departure, status: 'closed' }, { ...departure, start: '2026-11-02T10:00:00+04:00' }, { ...departure, start: '2026-10-31T09:00:00+04:00' }]) {
    assert.deepEqual(refreshSelections([item], [service], [altered], now).items, [{ serviceId: 'tour', date: '' }]);
  }
});
