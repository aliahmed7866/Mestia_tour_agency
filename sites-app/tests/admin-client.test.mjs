import test from 'node:test';
import assert from 'node:assert/strict';
import { readAdminData, saveAdminChange } from '../app/lib/admin-client.ts';

test('a saved payment stays successful when the following refresh fails, without resubmission', async t => {
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async () => { posts++; return Response.json({ ok: true }); });
  const result = await saveAdminChange({ action: 'recordPayment' }, async () => { throw new Error('offline'); });
  assert.equal(result.saved, true);
  assert.equal(result.needsRefresh, true);
  assert.match(result.error, /was saved/);
  assert.equal(posts, 1);
});

test('an unreadable successful response requires reconciliation before another mutation', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>proxy error</html>'));
  let reads = 0;
  const result = await saveAdminChange({ action: 'recordRefund' }, async () => { reads++; });
  assert.equal(result.saved, false);
  assert.equal(result.needsRefresh, true);
  assert.equal(reads, 0);
});

test('validation errors keep the draft editable; conflicts require a fresh workspace', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Choose a guide.' }, { status: 400 }));
  const invalid = await saveAdminChange({ action: 'saveDeparture' }, async () => assert.fail('must not reload'));
  assert.deepEqual(invalid, { saved: false, needsRefresh: false, error: 'Choose a guide.' });
  globalThis.fetch = async () => Response.json({ error: 'Departure changed.' }, { status: 409 });
  const conflict = await saveAdminChange({ action: 'saveDeparture' }, async () => assert.fail('must not reload'));
  assert.equal(conflict.needsRefresh, true);
  assert.equal(conflict.error, 'Departure changed.');
});

test('a failed or timed-out POST never retries automatically', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    posts++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true }));
  });
  const pending = saveAdminChange({ action: 'confirm' }, async () => assert.fail('must not reload'));
  t.mock.timers.tick(20000);
  const result = await pending;
  assert.equal(result.needsRefresh, true);
  assert.equal(result.saved, false);
  assert.equal(posts, 1);
});

test('server errors are uncertain; valid manual request receipts are accepted', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Temporary failure' }, { status: 503 }));
  const failure = await saveAdminChange({ action: 'createManual' }, async () => assert.fail('must not reload'));
  assert.equal(failure.needsRefresh, true);
  globalThis.fetch = async () => Response.json({ reference: 'MES-EXAMPLE', token: 'private-token' });
  let reads = 0;
  const saved = await saveAdminChange({ action: 'createManual' }, async () => { reads++; });
  assert.deepEqual(saved, { saved: true, needsRefresh: false, error: '' });
  assert.equal(reads, 1);
});

test('malformed workspace data is never used to replace the visible records', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ initialized: true, settings: {} }));
  await assert.rejects(readAdminData(), /Workspace details could not be read/);
});
