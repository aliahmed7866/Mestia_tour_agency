import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import {SQLiteD1} from './sqlite-d1.mjs';

const env = globalThis.__ownerTestEnv = {};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'cloudflare:workers') return {url: 'owner-test:env', shortCircuit: true};
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(url)) return {url: url.href, shortCircuit: true};
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    return url === 'owner-test:env' ? {format: 'module', source: 'export const env=globalThis.__ownerTestEnv;', shortCircuit: true} : next(url, context);
  },
});
const auth = await import('../app/lib/owner-auth.ts');
const route = await import('../app/api/owner-auth/route.ts');
const server = await import('../app/lib/server.ts');
const ORIGIN = 'https://owner.test';
const EMAIL = 'owner@example.test';
const PASSWORD = 'a-unique-test-password-2026';
const NOW = Date.now();
const encoder = new TextEncoder();
const keys = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
const jwk = {...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'test-key'};
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const claims = `${b64({alg: 'RS256', kid: jwk.kid})}.${b64({iss: 'https://test.cloudflareaccess.com', aud: ['test-audience'], email: EMAIL, exp: Math.floor(NOW / 1000) + 3600})}`;
const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, encoder.encode(claims));
const jwt = claims + '.' + Buffer.from(signature).toString('base64url');
const request = (headers = {}, data) => new Request(ORIGIN + '/api/owner-auth', {method: 'POST', headers: {origin: ORIGIN, 'cf-connecting-ip': '192.0.2.1', ...headers}, ...(data ? {body: JSON.stringify(data)} : {})});
const access = () => request({'Cf-Access-Jwt-Assertion': jwt});
const error = status => value => value.status === status;

function world(t, mode = 'native', migrate = true) {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, {DEPLOY_TARGET: 'cloudflare', OWNER_LOGIN_MODE: mode, ADMIN_EMAIL: EMAIL,
    OWNER_AUTH_SECRET: 'only-a-test-secret-not-for-real-use-12345', RESEND_API_KEY: 'test-key', OWNER_EMAIL_FROM: 'test@example.test',
    ACCESS_TEAM_DOMAIN: 'test.cloudflareaccess.com', ACCESS_AUD: 'test-audience'});
  const db = env.DB = new SQLiteD1();
  if (migrate) db.sqlite.exec(readFileSync(new URL('../migrations/0007_owner_auth.sql', import.meta.url), 'utf8'));
  db.sqlite.prepare('INSERT INTO settings(id,data) VALUES (?,?)').run('business', JSON.stringify({adminUserId: EMAIL}));
  t.after(() => db.close());
  let delivered = '';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/cdn-cgi/access/certs')) return Response.json({keys: [jwk]});
    assert.equal(String(url), 'https://api.resend.com/emails');
    const message = JSON.parse(options.body);
    assert.deepEqual(message.to, [EMAIL]);
    delivered = message.text.match(/code is (\d{6})/)[1];
    return Response.json({id: 'test-delivery'});
  });
  return {db, code: () => delivered};
}
async function setup() {env.OWNER_LOGIN_MODE = 'access'; await auth.setupPassword(access(), PASSWORD); env.OWNER_LOGIN_MODE = 'native';}
async function challenge() {return (await auth.startLogin(request(), EMAIL, PASSWORD)).challenge;}
async function login(w) {const id = await challenge(); return auth.finishLogin(request(), id, w.code());}

test('legacy Access and Sites status do not require native tables or secrets', async t => {
  world(t, 'access', false); delete env.OWNER_AUTH_SECRET;
  assert.deepEqual(await auth.ownerAuthStatus(request()), {mode: 'access', canSetup: false});
  assert.equal(await auth.ownerIdentity(access()), EMAIL);
  env.OWNER_AUTH_SECRET = 'optional-secret-with-missing-tables-12345';
  assert.deepEqual(await auth.ownerAuthStatus(request()), {mode: 'access', canSetup: false});
  delete env.DEPLOY_TARGET;
  assert.deepEqual(await auth.ownerAuthStatus(request()), {mode: 'sites', canSetup: false});
});

test('setup requires signed Access owner, matching workspace and a strong unique password', async t => {
  const {db} = world(t, 'access');
  await assert.rejects(auth.setupPassword(request({'oai-authenticated-user-id': EMAIL}), PASSWORD), error(401));
  await assert.rejects(auth.setupPassword(access(), 'short'), error(400));
  db.sqlite.prepare('UPDATE settings SET data=?').run(JSON.stringify({adminUserId: 'other@example.test'}));
  await assert.rejects(auth.setupPassword(access(), PASSWORD), error(403));
  db.sqlite.prepare('UPDATE settings SET data=?').run(JSON.stringify({adminUserId: EMAIL}));
  await auth.setupPassword(access(), PASSWORD);
  assert.equal((await auth.ownerAuthStatus(access())).canSetup, false);
  const saved = db.sqlite.prepare('SELECT * FROM owner_credentials').get();
  assert.notEqual(saved.password_hash, PASSWORD);
  assert.equal(saved.password_hash.length, 64);
  await assert.rejects(auth.setupPassword(access(), PASSWORD), error(409));
});

test('native mode denies anonymous, forged identity and Access-only admin access', async t => {
  world(t); await setup();
  for (const req of [request(), request({'oai-authenticated-user-id': EMAIL}), access()]) {
    await assert.rejects(server.adminData(req), error(401));
  }
  await assert.rejects(auth.setupPassword(access(), PASSWORD), error(403));
});

test('password/email errors never send codes or create a session', async t => {
  const w = world(t); await setup();
  await assert.rejects(auth.startLogin(request(), EMAIL, 'incorrect-password'), error(401));
  await assert.rejects(auth.startLogin(request(), 'other@example.test', PASSWORD), error(401));
  assert.equal(w.code(), '');
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) n FROM owner_sessions').get().n, 0);
});

test('email-code delivery, cookie headers, authenticated admin access and logout work end to end', async t => {
  const w = world(t); await setup();
  const start = await route.POST(request({}, {action: 'start', email: EMAIL, password: PASSWORD}));
  assert.equal(start.status, 200);
  const {challenge: id} = await start.json();
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) n FROM owner_sessions').get().n, 0);
  const response = await route.POST(request({}, {action: 'verify', challenge: id, code: w.code()}));
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=28800']) assert.ok(cookie.includes(flag));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const signedIn = request({cookie: cookie.split(';')[0]});
  assert.equal((await auth.ownerAuthStatus(signedIn)).authenticated, true);
  assert.equal((await server.adminData(signedIn)).identity, EMAIL);
  const loggedOut = await route.POST(request({cookie: cookie.split(';')[0]}, {action: 'logout'}));
  assert.equal(loggedOut.status, 200);
  assert.match(loggedOut.headers.get('set-cookie'), /Max-Age=0/);
  await assert.rejects(server.adminData(signedIn), error(401));
});

test('codes are single use even for concurrent verification requests', async t => {
  const w = world(t); await setup(); const id = await challenge();
  const results = await Promise.allSettled([auth.finishLogin(request(), id, w.code()), auth.finishLogin(request(), id, w.code())]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) n FROM owner_sessions').get().n, 1);
});

test('five wrong guesses exhaust a challenge; expired codes cannot sign in', async t => {
  const w = world(t); await setup(); const id = await challenge();
  const wrong = w.code() === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await assert.rejects(auth.finishLogin(request(), id, wrong), error(401));
  await assert.rejects(auth.finishLogin(request(), id, w.code()), error(401));
  const fresh = await challenge();
  w.db.sqlite.prepare('UPDATE owner_codes SET expires_at=?').run(Math.floor(Date.now() / 1000));
  await assert.rejects(auth.finishLogin(request(), fresh, w.code()), error(401));
});

test('a newer code replaces the earlier challenge', async t => {
  const w = world(t); await setup(); const old = await challenge(), oldCode = w.code();
  const fresh = await challenge();
  await assert.rejects(auth.finishLogin(request(), old, oldCode), error(401));
  assert.ok(await auth.finishLogin(request(), fresh, w.code()));
});

test('email errors and timeouts remove the undelivered challenge', async t => {
  const w = world(t); await setup();
  for (const response of [() => new Response('', {status: 500}), () => {throw new DOMException('Timed out', 'TimeoutError');}]) {
    t.mock.method(globalThis, 'fetch', response);
    await assert.rejects(auth.startLogin(request(), EMAIL, PASSWORD), error(503));
    assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) n FROM owner_codes').get().n, 0);
  }
});

test('password attempts are limited per IP and email sends across IP addresses', async t => {
  world(t); await setup();
  for (let i = 0; i < 12; i++) await assert.rejects(auth.startLogin(request(), '', ''), error(401));
  await assert.rejects(auth.startLogin(request(), EMAIL, PASSWORD), error(429));
  for (let i = 0; i < 5; i++) await auth.startLogin(request({'cf-connecting-ip': '192.0.2.' + (i + 2)}), EMAIL, PASSWORD);
  await assert.rejects(auth.startLogin(request({'cf-connecting-ip': '192.0.2.99'}), EMAIL, PASSWORD), error(429));
});

test('expired sessions and sessions issued to a previous owner are rejected', async t => {
  const w = world(t); await setup(); const token = await login(w); const req = request({cookie: 'svaneti_owner=' + token});
  env.ADMIN_EMAIL = 'new-owner@example.test';
  await assert.rejects(auth.nativeOwner(req), error(401));
  env.ADMIN_EMAIL = EMAIL;
  w.db.sqlite.prepare('UPDATE owner_sessions SET expires_at=?').run(Math.floor(Date.now() / 1000));
  await assert.rejects(auth.nativeOwner(req), error(401));
});

test('rollback enforces Access again and blocks native login endpoints', async t => {
  const w = world(t); await setup(); const token = await login(w);
  delete env.OWNER_LOGIN_MODE;
  await assert.rejects(auth.ownerIdentity(request({cookie: 'svaneti_owner=' + token})), error(401));
  assert.equal(await auth.ownerIdentity(access()), EMAIL);
  await assert.rejects(auth.startLogin(request(), EMAIL, PASSWORD), error(403));
  await assert.rejects(auth.finishLogin(request(), 'a'.repeat(48), '123456'), error(403));
});

test('owner writes reject cross-origin requests before sending email or mutating credentials', async t => {
  const w = world(t); await setup();
  const response = await route.POST(request({origin: 'https://other.test'}, {action: 'start', email: EMAIL, password: PASSWORD}));
  assert.equal(response.status, 403); assert.equal(w.code(), '');
});


test('pending email challenges cannot transfer to a newly configured owner', async t => {
  const w = world(t); await setup(); const id = await challenge();
  env.ADMIN_EMAIL = 'replacement@example.test';
  await assert.rejects(auth.finishLogin(request(), id, w.code()), error(401));
  assert.equal(w.db.sqlite.prepare('SELECT COUNT(*) n FROM owner_sessions').get().n, 0);
});
