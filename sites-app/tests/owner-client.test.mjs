import test from 'node:test';
import assert from 'node:assert/strict';
import {ownerRequest, readOwnerStatus} from '../app/lib/owner-client.ts';

test('owner status preserves legacy modes and validates native session state', async t => {
  for (const mode of ['sites', 'access']) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({mode}));
    assert.deepEqual(await readOwnerStatus(), {mode});
  }
  t.mock.method(globalThis, 'fetch', async () => Response.json({mode: 'native', configured: true, authenticated: false}));
  assert.equal((await readOwnerStatus()).authenticated, false);
  for (const body of [{}, {mode: 'native'}, {mode: 'unexpected'}, []]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(readOwnerStatus());
  }
});

test('sign-in sends only the supplied step fields with protected browser credentials', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/owner-auth');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {action: 'verify', challenge: 'test', code: '123456'});
    return Response.json({ok: true});
  });
  assert.deepEqual(await ownerRequest({action: 'verify', challenge: 'test', code: '123456'}), {ok: true});
});

test('rate limits, malformed responses and network timeouts are recoverable errors', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({error: 'Too many attempts.'}, {status: 429}));
  await assert.rejects(ownerRequest({action: 'start'}), /Too many attempts/);
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Sign in</html>'));
  await assert.rejects(readOwnerStatus(), /could not be checked/);
  t.mock.method(globalThis, 'fetch', async () => {throw new DOMException('Timed out', 'TimeoutError');});
  await assert.rejects(readOwnerStatus(), /connection could not be completed/);
});
