import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { randomUUID, scryptSync } from 'node:crypto';
import path from 'node:path';
import { database, migrate, localDB } from '../server/storage.mjs';
import { env, withRequest } from './server-fixture.mjs';
import * as session from '../app/api/admin/session/route.ts';
import * as settings from '../app/api/admin/settings/route.ts';
import * as chat from '../app/api/chat/route.ts';
import * as images from '../app/api/chat/image/[id]/route.ts';
import * as publicSettings from '../app/api/site-settings/route.ts';
import * as moderation from '../app/api/admin/chat/route.ts';
import * as tracks from '../app/api/track-requests/route.ts';
import * as adminTracks from '../app/api/admin/tracks/route.ts';
import * as reports from '../app/api/admin/report/route.ts';
import * as health from '../app/api/health/route.ts';
import * as support from '../app/api/support/tickets/route.ts';
import * as integration from '../app/api/support/integration/route.ts';
import * as adminSupport from '../app/api/admin/support/route.ts';
import { defaultStudio } from '../app/studio-config.ts';

mkdirSync('work', { recursive: true });
process.env.CDEK_DATA_DIR = mkdtempSync(path.resolve('work/api-test-'));
process.env.CDEK_RUNTIME = 'node';
const password = 'backend-test-password';
const salt = Buffer.alloc(16, 17);
const token = 'test-only-integration-token-0123456789';
let adminCookie;

function request(url, method = 'GET', body, extra = {}) {
  return new Request('https://cdek-fm.test' + url, {
    method,
    headers: { origin: 'https://cdek-fm.test', 'cf-connecting-ip': '192.0.2.1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}
function call(handler, url, method, body, headers) {
  return withRequest(request(url, method, body, headers), handler);
}
const authenticated = () => ({ cookie: adminCookie });

before(() => {
  migrate();
  env.CDEK_ADMIN_PASSWORD_HASH = 'scrypt$' + salt.toString('hex') + '$' + scryptSync(password, salt, 32,
    { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }).toString('hex');
  env.CDEK_SUPPORT_API_TOKEN = token;
});
beforeEach(async () => {
  for (const key of ['CDEK_SUPPORT_EMAIL_FROM', 'CDEK_SUPPORT_RESEND_KEY', 'CDEK_SUPPORT_HELPDESK_URL', 'CDEK_SUPPORT_HELPDESK_TOKEN']) delete env[key];
  for (const name of ['support_delivery', 'support_ticket', 'support_settings', 'chat_message',
    'chat_moderation', 'track_request', 'studio_session', 'studio_login_attempt', 'site_studio']) database().exec('DELETE FROM ' + name);
  const login = await call(session.POST, '/api/admin/session', 'POST', new URLSearchParams({ action: 'login', username: 'megapolis', password }).toString(),
    { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(login.status, 303);
  adminCookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(adminCookie);
});
after(() => database().close());

test('admin writes require a session and same origin; logout revokes the token', async () => {
  const forged = await call(settings.PUT, '/api/admin/settings', 'PUT', {},
    { 'oai-authenticated-user-id': 'spoofed', 'oai-authenticated-user-email': 'editor@example.com' });
  assert.equal(forged.status, 403);
  const crossSite = await call(settings.PUT, '/api/admin/settings', 'PUT', {},
    { ...authenticated(), origin: 'https://unrelated.test', 'sec-fetch-site': 'cross-site' });
  assert.equal(crossSite.status, 403);
  assert.equal((await call(reports.GET, '/api/admin/report', 'GET', undefined, authenticated())).status, 200);
  const logout = await call(session.POST, '/api/admin/session', 'POST', 'action=logout',
    { ...authenticated(), 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await call(reports.GET, '/api/admin/report', 'GET', undefined, authenticated())).status, 403);
});

test('publishing checks the revision and does not overwrite another editor', async () => {
  const studio = defaultStudio();
  const first = await call(settings.PUT, '/api/admin/settings', 'PUT', { studio, revision: 0 }, authenticated());
  assert.equal(first.status, 200);
  const saved = await first.json();
  studio.editions.before.hero.title = 'Conflicting edit';
  const stale = await call(settings.PUT, '/api/admin/settings', 'PUT', { studio, revision: 0 }, authenticated());
  assert.equal(stale.status, 409);
  assert.deepEqual((await stale.json()).current, saved);
});

test('chat retries are idempotent and the sending cooldown is enforced', async () => {
  const body = { id: randomUUID(), client: randomUUID(), body: 'A test greeting' };
  assert.equal((await call(chat.POST, '/api/chat', 'POST', body)).status, 201);
  assert.equal((await call(chat.POST, '/api/chat', 'POST', body)).status, 200);
  assert.equal((await call(chat.POST, '/api/chat', 'POST', { ...body, id: randomUUID() })).status, 429);
  assert.equal((await localDB.prepare('SELECT COUNT(*) AS count FROM chat_message').first('count')), 1);
});

test('moderation removes a whole reply tree and its attachments', async () => {
  const root = randomUUID(), reply = randomUUID(), nested = randomUUID();
  for (const [id, parent, thread] of [[root, null, null], [reply, root, root], [nested, reply, root]]) {
    await localDB.prepare('INSERT INTO chat_message (id, client_key, body, created_at, parent_id, thread_id, image_key) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, 'client', 'test', Date.now(), parent, thread, 'chat/' + id).run();
    await env.BUCKET.put('chat/' + id, new Uint8Array([1, 2, 3]));
  }
  const response = await call(moderation.DELETE, '/api/admin/chat', 'DELETE', { ids: [root] }, authenticated());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, 3);
  for (const id of [root, reply, nested]) assert.equal(await env.BUCKET.get('chat/' + id), null);
});

test('closed track requests cannot be posted; acceptance is idempotent', async () => {
  const body = { id: randomUUID(), client: randomUUID(), title: 'A test song' };
  assert.equal((await call(tracks.POST, '/api/track-requests', 'POST', body)).status, 403);
  const studio = defaultStudio(); studio.editions.before.tracksEnabled = true;
  await call(settings.PUT, '/api/admin/settings', 'PUT', { studio, revision: 0 }, authenticated());
  assert.equal((await call(tracks.POST, '/api/track-requests', 'POST', body)).status, 201);
  assert.equal((await call(tracks.POST, '/api/track-requests', 'POST', body)).status, 200);
  const first = await (await call(adminTracks.PATCH, '/api/admin/tracks', 'PATCH', { id: body.id, accepted: true }, authenticated())).json();
  const second = await (await call(adminTracks.PATCH, '/api/admin/tracks', 'PATCH', { id: body.id, accepted: true }, authenticated())).json();
  assert.equal(first.acceptedAt, second.acceptedAt);
});

test('support retries create one ticket and one delivery per channel; status updates detect conflicts', async () => {
  const body = { id: randomUUID(), email: 'Listener@Example.com', description: 'Help with the broadcast' };
  const first = await call(support.POST, '/api/support/tickets', 'POST', body);
  assert.equal(first.status, 201);
  const saved = await first.json();
  const again = await call(support.POST, '/api/support/tickets', 'POST', body);
  assert.equal(again.status, 200); assert.deepEqual(await again.json(), saved);
  assert.equal(await localDB.prepare('SELECT COUNT(*) AS count FROM support_delivery').first('count'), 2);
  const headers = { authorization: 'Bearer ' + token };
  const ticket = (await (await call(integration.GET, '/api/support/integration?id=' + saved.id, 'GET', undefined, headers)).json()).ticket;
  const changed = await call(integration.PATCH, '/api/support/integration', 'PATCH', { id: ticket.id, status: 'in_progress', updatedAt: ticket.updatedAt }, headers);
  assert.equal(changed.status, 200);
  const stale = await call(integration.PATCH, '/api/support/integration', 'PATCH', { id: ticket.id, status: 'resolved', updatedAt: ticket.updatedAt }, headers);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).ticket.status, 'in_progress');
  assert.equal((await call(integration.GET, '/api/support/integration')).status, 401);
});

test('healthcheck accepts a fully migrated empty database', async () => {
  assert.equal((await health.GET()).status, 200);
});

test('healthcheck rejects a partially migrated application schema', async () => {
  database().exec('ALTER TABLE support_settings RENAME TO missing_support_settings');
  try { assert.equal((await health.GET()).status, 503); }
  finally { database().exec('ALTER TABLE missing_support_settings RENAME TO support_settings'); }
});

test('healthcheck rejects a missing required column as well as a missing table', async () => {
  database().exec('ALTER TABLE support_ticket RENAME COLUMN description TO missing_description');
  try { assert.equal((await health.GET()).status, 503); }
  finally { database().exec('ALTER TABLE support_ticket RENAME COLUMN missing_description TO description'); }
});

test('database failures return retryable JSON to public API clients', async t => {
  const prepare = t.mock.method(env.DB, 'prepare', () => { throw new Error('Test-only database failure'); });
  try {
    for (const [handler, url, method, body, headers] of [
      [chat.GET, '/api/chat'],
      [chat.POST, '/api/chat', 'POST', { id: randomUUID(), client: randomUUID(), body: 'hello' }],
      [publicSettings.GET, '/api/site-settings'],
      [tracks.POST, '/api/track-requests', 'POST', { id: randomUUID(), client: randomUUID(), title: 'song' }],
      [settings.PUT, '/api/admin/settings', 'PUT', {}, authenticated()],
      [moderation.GET, '/api/admin/chat', 'GET', undefined, authenticated()],
      [moderation.DELETE, '/api/admin/chat', 'DELETE', { clear: true }, authenticated()],
      [reports.GET, '/api/admin/report', 'GET', undefined, authenticated()],
      [adminTracks.PATCH, '/api/admin/tracks', 'PATCH', { id: randomUUID(), accepted: true }, authenticated()],
    ]) {
      const response = await call(handler, url, method, body, headers);
      assert.equal(response.status, 503, url);
      assert.match(response.headers.get('content-type'), /application\/json/, url);
      assert.equal(typeof (await response.json()).error, 'string');
    }
  } finally { prepare.mock.restore(); }
});

test('chat images are persisted, served with an etag, and return 304 for the same version', async () => {
  const id = randomUUID();
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLc8AAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.set('id', id); form.set('client', randomUUID()); form.set('body', 'with an image');
  form.set('image', new File([bytes], 'image.png', { type: 'image/png' }));
  const posted = await withRequest(new Request('https://cdek-fm.test/api/chat', { method: 'POST', body: form,
    headers: { origin: 'https://cdek-fm.test', 'cf-connecting-ip': '192.0.2.2' } }), chat.POST);
  assert.equal(posted.status, 201);
  const response = await withRequest(request('/api/chat/image/' + id), images.GET, { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.match(response.headers.get('content-type'), /^image\/png/);
  const cached = await withRequest(request('/api/chat/image/' + id, 'GET', undefined, { 'if-none-match': response.headers.get('etag') }), images.GET,
    { params: Promise.resolve({ id }) });
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get('content-length'), null);
});

test('login throttling blocks repeated guesses and expires without locking out the editor forever', async () => {
  const form = new URLSearchParams({ action: 'login', username: 'megapolis', password: 'wrong-password' }).toString();
  const headers = { 'content-type': 'application/x-www-form-urlencoded' };
  for (let attempt = 0; attempt < 12; attempt++) {
    assert.equal((await call(session.POST, '/api/admin/session', 'POST', form, headers)).headers.get('location'), '/admin?error=credentials');
  }
  assert.equal((await call(session.POST, '/api/admin/session', 'POST', form, headers)).headers.get('location'), '/admin?error=limited');
  database().exec('UPDATE studio_login_attempt SET expires_at = 0');
  const valid = new URLSearchParams({ action: 'login', username: 'megapolis', password }).toString();
  assert.equal((await call(session.POST, '/api/admin/session', 'POST', valid, headers)).headers.get('location'), '/admin');
});

test('support delivery failures retain the ticket and only explicit retry repeats failed channels', async t => {
  env.CDEK_SUPPORT_EMAIL_FROM = 'studio@example.com'; env.CDEK_SUPPORT_RESEND_KEY = 'test-only-mail-key';
  env.CDEK_SUPPORT_HELPDESK_URL = 'https://helpdesk.example.test/tickets'; env.CDEK_SUPPORT_HELPDESK_TOKEN = token;
  await call(adminSupport.PATCH, '/api/admin/support', 'PATCH', { action: 'email', email: 'support@example.com' }, authenticated());
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: ++attempts <= 2 ? 503 : 200 }));
  const body = { id: randomUUID(), email: 'listener@example.com', description: 'Test delivery retry' };
  assert.equal((await call(support.POST, '/api/support/tickets', 'POST', body)).status, 201);
  assert.equal(attempts, 2);
  assert.equal((await call(support.POST, '/api/support/tickets', 'POST', body)).status, 200);
  assert.equal(attempts, 2);
  const retry = { action: 'retry', id: body.id };
  assert.equal((await call(adminSupport.PATCH, '/api/admin/support', 'PATCH', retry, authenticated())).status, 200);
  assert.equal(attempts, 4);
  assert.deepEqual((await localDB.prepare('SELECT state, attempts FROM support_delivery ORDER BY channel').all()).results.map(row => [row.state, row.attempts]),
    [['sent', 2], ['sent', 2]]);
  await call(adminSupport.PATCH, '/api/admin/support', 'PATCH', retry, authenticated());
  assert.equal(attempts, 4);
});

test('concurrent support retries save one ticket and the same public ticket number', async () => {
  const body = { id: randomUUID(), email: 'listener@example.com', description: 'One logical request' };
  const responses = await Promise.all(Array.from({ length: 6 }, () => call(support.POST, '/api/support/tickets', 'POST', body)));
  assert.equal(responses.filter(response => response.status === 201).length, 1);
  const numbers = await Promise.all(responses.map(async response => (await response.json()).number));
  assert.equal(new Set(numbers).size, 1);
  assert.equal(await localDB.prepare('SELECT COUNT(*) AS count FROM support_ticket').first('count'), 1);
});

test('an invalid moderation cursor is rejected without changing stored data', async () => {
  assert.equal((await call(moderation.GET, '/api/admin/chat?before=invalid', 'GET', undefined, authenticated())).status, 400);
  assert.equal((await call(adminSupport.PATCH, '/api/admin/support', 'PATCH', { action: 'retry', id: 'bad' }, authenticated())).status, 400);
});

test('CSV export does not duplicate requests when another song arrives between pages', async t => {
  const db = database();
  const insert = db.prepare('INSERT INTO track_request (id, author_key, author_name, title, artist, phase, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (let index = 0; index < 450; index++) insert.run('track-' + index, 'author', 'Guest', 'Track ' + index, 'Artist', 'before', index + 1);
  const prepare = db.prepare.bind(db);
  let inserted = false;
  t.mock.method(db, 'prepare', sql => {
    const statement = prepare(sql);
    if (sql.includes('FROM track_request') && sql.includes('LIMIT')) {
      const all = statement.all.bind(statement);
      statement.all = (...values) => {
        const result = all(...values);
        if (!inserted) { inserted = true; insert.run('new-track', 'author', 'Guest', 'New track', 'Artist', 'before', 1000); }
        return result;
      };
    }
    return statement;
  });
  const response = await call(reports.GET, '/api/admin/report?download=tracks', 'GET', undefined, authenticated());
  assert.equal(response.status, 200);
  const titles = (await response.text()).split('\r\n').slice(1).filter(Boolean).map(line => line.split(';')[0]);
  assert.equal(titles.length, 450);
  assert.equal(new Set(titles).size, 450);
  assert.ok(inserted);
});

test('participant CSV keeps stable pages when an existing author sends another message', async t => {
  const db = database();
  const insert = db.prepare('INSERT INTO chat_message (id, client_key, author_key, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (let index = 0; index < 450; index++) {
    const author = 'author-' + String(index).padStart(3, '0');
    insert.run('message-' + index, author, author, 'Guest ' + index, 'test', index + 1);
  }
  const prepare = db.prepare.bind(db);
  let inserted = false;
  t.mock.method(db, 'prepare', sql => {
    const statement = prepare(sql);
    if (sql.includes('FROM authors') && sql.includes('LIMIT')) {
      const all = statement.all.bind(statement);
      statement.all = (...values) => {
        const result = all(...values);
        if (!inserted) { inserted = true; insert.run('new-message', 'author-000', 'author-000', 'Guest 0', 'test', 1000); }
        return result;
      };
    }
    return statement;
  });
  const response = await call(reports.GET, '/api/admin/report?download=participants', 'GET', undefined, authenticated());
  assert.equal(response.status, 200);
  const names = (await response.text()).split('\r\n').slice(1).filter(Boolean).map(line => line.split(';')[0]);
  assert.equal(names.length, 450);
  assert.equal(new Set(names).size, 450);
  assert.ok(inserted);
});

test('activity CSV visits every day once when a new day appears between pages', async t => {
  const db = database();
  const insert = db.prepare('INSERT INTO chat_message (id, client_key, body, created_at) VALUES (?, ?, ?, ?)');
  const start = Date.UTC(2025, 0, 1);
  for (let index = 0; index < 450; index++) insert.run('message-' + index, 'client', 'test', start + index * 86_400_000);
  const prepare = db.prepare.bind(db);
  let inserted = false;
  t.mock.method(db, 'prepare', sql => {
    const statement = prepare(sql);
    if (sql.includes('FROM activity') && sql.includes('LIMIT')) {
      const all = statement.all.bind(statement);
      statement.all = (...values) => {
        const result = all(...values);
        if (!inserted) { inserted = true; insert.run('new-day', 'client', 'test', start + 500 * 86_400_000); }
        return result;
      };
    }
    return statement;
  });
  const response = await call(reports.GET, '/api/admin/report?download=activity', 'GET', undefined, authenticated());
  assert.equal(response.status, 200);
  const days = (await response.text()).split('\r\n').slice(1).filter(Boolean).map(line => line.split(';')[0]);
  assert.equal(days.length, 450);
  assert.equal(new Set(days).size, 450);
  assert.ok(inserted);
});
