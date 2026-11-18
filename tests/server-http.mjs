import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID, scryptSync } from 'node:crypto';
import { cpSync, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { database } from '../server/storage.mjs';

mkdirSync('work', { recursive: true });
assert.ok(existsSync('dist/standalone/server.js'), 'Run npm run build:server before the HTTP test');
// Test outside the checkout so a missing runtime dependency cannot accidentally
// resolve through the developer's complete node_modules directory.
const runtime = mkdtempSync(path.join(tmpdir(), 'cdek-http-'));
cpSync('dist/standalone', runtime, { recursive: true });
for (const directory of ['server', 'drizzle']) cpSync(directory, path.join(runtime, directory), { recursive: true });
mkdirSync(path.join(runtime, 'scripts'));
cpSync('scripts/server.mjs', path.join(runtime, 'scripts/server.mjs'));
cpSync('scripts/register-support.mjs', path.join(runtime, 'scripts/register-support.mjs'));
process.env.CDEK_DATA_DIR = path.join(runtime, 'data');
for (const dependency of ['eslint', 'typescript', 'drizzle-kit', 'wrangler', '@cloudflare/vite-plugin', 'vite']) {
  assert.ok(!existsSync(path.join(runtime, 'node_modules', dependency)), 'Build tool leaked into runtime: ' + dependency);
}
assert.match(readFileSync(path.join(runtime, 'node_modules/picomatch/lib/parse.js'), 'utf8'), /CDEK mitigation: GHSA-fc5q-39xc-vjpf/);
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const password = randomUUID();
const salt = Buffer.alloc(16, 23);
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), CDEK_RUNTIME: 'node', CDEK_EDITOR_EMAILS: '',
  CDEK_SUPPORT_PLATFORM_URL: 'https://support.test/websites/api/v1',
  CDEK_SUPPORT_PLATFORM_KEY: 'sw_live_http_fixture_not_a_real_secret_0123456789', CDEK_SUPPORT_SITE_ORIGIN: 'https://cdek-fm.test',
  VINEXT_TRUST_PROXY: '1', VINEXT_TRUSTED_HOSTS: 'cdek-fm.test',
  CDEK_ADMIN_PASSWORD_HASH: 'scrypt$' + salt.toString('hex') + '$' + scryptSync(password, salt, 32,
    { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex') };
for (const key of ['CDEK_SUPPORT_EMAIL_FROM', 'CDEK_SUPPORT_RESEND_KEY', 'CDEK_SUPPORT_HELPDESK_URL',
  'CDEK_SUPPORT_HELPDESK_TOKEN', 'CDEK_SUPPORT_API_TOKEN']) delete env[key];
execFileSync(process.execPath, ['scripts/server.mjs', 'migrate'], { cwd: runtime, env, windowsHide: true, stdio: 'pipe' });
const server = spawn(process.execPath, ['server.js'],
  { cwd: runtime, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const log = createWriteStream('work/audit-http-server.log');
server.stdout.pipe(log); server.stderr.pipe(log);
const base = 'http://127.0.0.1:' + port;
const request = (url, options = {}) => fetch(base + url, { ...options, redirect: 'manual',
  headers: { origin: base, ...options.headers }, signal: AbortSignal.timeout(5000) });
const json = (url, body, options = {}) => request(url, { ...options, method: options.method ?? 'POST',
  body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...options.headers } });
let checks = 0;
const check = (actual, expected, name) => { assert.equal(actual, expected, name); checks++; };
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Production server exited during startup');
    try { ready = (await request('/api/health')).status === 200; } catch {}
    if (ready) break;
    await delay(250);
  }
  assert.ok(ready, 'Production server became healthy'); checks++;
  const proof = await request('/.well-known/support-bridge.json?challenge=http-contract-check');
  check(proof.status, 200, 'central support bridge proof route');
  const bridgeIdentity = await proof.json();
  check(bridgeIdentity.protocol, 'support-websites', 'bridge protocol');
  check(bridgeIdentity.origin, 'https://cdek-fm.test', 'bridge canonical origin');
  check((await request('/.well-known/support-bridge.json?challenge=bad')).status, 400, 'invalid bridge challenge');
  check((await request('/support-api/session')).status, 401, 'anonymous support session');
  check((await request('/api/admin/support/central')).status, 403, 'anonymous central support inbox');
  check((await json('/support-api/session', { name: 'Test', externalUserId: 'spoofed' })).status, 400, 'support cannot impersonate an account');
  check((await json('/support-api/session', { name: 'Test' }, { headers: { origin: 'https://other.test' } })).status, 403, 'support bridge origin guard');
  for (const url of ['/', '/admin', '/api/site-settings', '/api/chat', '/visual/cdek-fm.svg']) check((await request(url)).status, 200, url);
  const landing = await (await request('/')).text();
  const assets = [...landing.matchAll(/(?:src|href)="(\/[^" ]+\.(?:js|css)(?:\?[^" ]*)?)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0, 'Landing page references its built assets'); checks++;
  for (const asset of [...new Set(assets)].slice(0, 6)) check((await request(asset)).status, 200, asset);
  const motion = await request('/motion?variant=tele');
  check(motion.status, 200, 'motion page');
  assert.match(await motion.text(), /data-variant="tele"/); checks++;
  check((await request('/page-that-does-not-exist')).status, 404, 'missing page');
  check((await request('/api/admin/report')).status, 403, 'anonymous report');
  check((await json('/api/admin/settings', {}, { method: 'PUT', headers: { 'oai-authenticated-user-email': 'editor@example.com' } })).status, 403, 'forged editor');
  const login = await request('/api/admin/session', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'login', username: 'megapolis', password }).toString() });
  check(login.status, 303, 'login');
  assert.match(login.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/); checks++;
  const cookie = login.headers.get('set-cookie').split(';')[0];
  check((await request('/api/admin/report', { headers: { cookie } })).status, 200, 'authenticated report');
  check((await json('/api/admin/settings', {}, { method: 'PUT', headers: { cookie } })).status, 400, 'settings validation');
  check((await json('/api/admin/settings', {}, { method: 'PUT', headers: { cookie, origin: 'https://unrelated.test' } })).status, 403, 'cross-origin write');
  const message = { id: randomUUID(), client: randomUUID(), body: 'HTTP smoke test' };
  check((await json('/api/chat', message)).status, 201, 'new chat message');
  check((await json('/api/chat', message)).status, 200, 'chat retry');
  const imageId = randomUUID();
  const imageClient = randomUUID();
  const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLc8AAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('id', imageId); form.set('client', imageClient); form.set('body', 'HTTP image');
  form.set('image', new File([picture], 'image.png', { type: 'image/png' }));
  const uploaded = await request('/api/chat', { method: 'POST', body: form });
  check(uploaded.status, 201, 'image upload');
  check((await uploaded.json()).photoAllowance.remaining, 2, 'remaining photo allowance');
  const remaining = await request('/api/chat/photo-limit?client=' + imageClient);
  check(remaining.status, 200, 'photo allowance route');
  check((await remaining.json()).remaining, 2, 'photo allowance after reload');
  check((await request('/api/chat/photo-limit?client=invalid')).status, 400, 'invalid photo client');
  check((await request('/api/chat', { method: 'POST', body: form })).status, 200, 'photo retry');
  check((await (await request('/api/chat/photo-limit?client=' + imageClient)).json()).remaining, 2, 'photo retry does not consume allowance');
  const image = await request('/api/chat/image/' + imageId);
  check(image.status, 200, 'image read');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), picture); checks++;
  check((await request('/api/chat/image/' + imageId, { headers: { 'if-none-match': image.headers.get('etag') } })).status, 304, 'image cache');
  const storageBytes = database().prepare('SELECT bytes FROM local_upload_usage WHERE id = 1').get().bytes;
  database().prepare('UPDATE local_upload_usage SET bytes = ? WHERE id = 1').run(20 * 1024 ** 3);
  try {
    form.set('id', randomUUID()); form.set('client', randomUUID());
    check((await request('/api/chat', { method: 'POST', body: form })).status, 507, 'full photo storage');
    check((await json('/api/chat', { id: randomUUID(), client: randomUUID(), body: 'Text with full photo storage' })).status, 201, 'text with full photo storage');
    check((await request('/api/chat/image/' + imageId)).status, 200, 'existing photo with full storage');
  } finally { database().prepare('UPDATE local_upload_usage SET bytes = ? WHERE id = 1').run(storageBytes); }
  check((await json('/api/track-requests', { id: randomUUID(), client: randomUUID(), title: 'Test song' })).status, 403, 'closed tracks');
  const ticket = { id: randomUUID(), email: 'listener@example.com', description: 'HTTP support test' };
  check((await json('/api/support/tickets', ticket)).status, 201, 'new ticket');
  check((await json('/api/support/tickets', ticket)).status, 200, 'ticket retry');
  for (const kind of ['tracks', 'participants', 'activity']) {
    const response = await request('/api/admin/report?download=' + kind, { headers: { cookie } });
    check(response.status, 200, 'CSV ' + kind);
    assert.match(response.headers.get('content-type'), /text\/csv/); checks++;
    await response.text();
  }
  database().exec('ALTER TABLE support_settings RENAME TO missing_support_settings');
  try { check((await request('/api/health')).status, 503, 'incomplete migration'); }
  finally { database().exec('ALTER TABLE missing_support_settings RENAME TO support_settings'); }
  database().exec('ALTER TABLE chat_message RENAME TO missing_chat_message');
  try {
    const response = await request('/api/chat');
    check(response.status, 503, 'database failure');
    assert.equal(typeof (await response.json()).error, 'string'); checks++;
  } finally { database().exec('ALTER TABLE missing_chat_message RENAME TO chat_message'); }
  check((await request('/api/health')).status, 200, 'recovered health');
  const proxyHeaders = { host: 'cdek-fm.test', 'x-forwarded-host': 'cdek-fm.test', 'x-forwarded-proto': 'https',
    origin: 'https://cdek-fm.test', 'cf-connecting-ip': '192.0.2.88' };
  const proxyLogin = await request('/api/admin/session', { method: 'POST',
    headers: { ...proxyHeaders, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'login', username: 'megapolis', password }).toString() });
  check(proxyLogin.status, 303, 'HTTPS proxy login');
  const proxyCookie = proxyLogin.headers.get('set-cookie').split(';')[0];
  const proxySession = { ...proxyHeaders, cookie: proxyCookie };
  check((await request('/api/admin/report', { headers: proxySession })).status, 200, 'HTTPS proxy session');
  check((await json('/api/admin/settings', {}, { method: 'PUT', headers: proxySession })).status, 400, 'HTTPS proxy same-origin validation');
  check((await json('/api/chat', { id: randomUUID(), client: randomUUID(), body: 'Proxied request' }, { headers: proxyHeaders })).status, 201, 'HTTPS proxy public form');
  check((await json('/api/admin/settings', {}, { method: 'PUT', headers: { ...proxySession, origin: 'https://unrelated.test' } })).status, 403, 'HTTPS proxy cross-origin rejection');
  check((await json('/api/chat', {}, { headers: { ...proxyHeaders, origin: 'https://unrelated.test', 'x-forwarded-host': 'unrelated.test' } })).status, 403, 'Untrusted forwarded host');
  check((await request('/api/admin/session', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'action=logout' })).status, 303, 'logout');
  check((await request('/api/admin/report', { headers: { cookie } })).status, 403, 'revoked cookie');
  console.log('Production HTTP smoke passed: ' + checks + ' checks');
} finally {
  server.kill();
  if (server.exitCode === null) await once(server, 'exit');
  database().close();
  log.end();
  // Only remove this test's freshly created directory, never an arbitrary path.
  assert.equal(path.dirname(path.resolve(runtime)), path.resolve(tmpdir()));
  assert.ok(path.basename(runtime).startsWith('cdek-http-'));
  rmSync(runtime, { recursive: true });
}
