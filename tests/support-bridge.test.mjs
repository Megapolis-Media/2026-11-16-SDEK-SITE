import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { database, migrate } from '../server/storage.mjs';
import { env, withRequest } from './server-fixture.mjs';
import * as route from '../app/support-api/[...path]/route.ts';
import { GET as proof } from '../app/.well-known/support-bridge.json/route.ts';

mkdirSync('work', { recursive: true });
process.env.CDEK_DATA_DIR = mkdtempSync(path.resolve('work/bridge-test-'));
const key = 'sw_live_fixture_key_not_a_real_secret_0123456789';
const token = 'sw_session_fixture_guest_0123456789abcdef';
const guest = { id: 1, kind: 'guest', name: 'Тестовый посетитель' };
const ticket = { id: 1, ticketId: 'T-1001', status: 'NEW', subject: 'Test' };
const message = { id: 1, body: 'Test', authorName: 'Тест', authorType: 'visitor', thread: 'client', createdAt: '2026-11-18T00:00:00Z' };
let requests;
let respond;
const realFetch = globalThis.fetch;
const cookie = '__Host-cdek-support=' + token;
function call(action, body, headers = {}) {
  const request = new Request('https://cdek-fm.test/support-api/' + action, {
    method: body === undefined ? 'GET' : 'POST', headers: { origin: 'https://cdek-fm.test',
      'cf-connecting-ip': '192.0.2.80', cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return withRequest(request, body === undefined ? route.GET : route.POST,
    { params: Promise.resolve({ path: action.split('?')[0].split('/') }) });
}
before(() => migrate());
beforeEach(() => {
  database().exec('DELETE FROM support_bridge_rate');
  env.CDEK_SUPPORT_PLATFORM_URL = 'https://support.test/websites/api/v1';
  env.CDEK_SUPPORT_PLATFORM_KEY = key;
  env.CDEK_SUPPORT_SITE_ORIGIN = 'https://cdek-fm.test';
  requests = [];
  respond = (url, options, body) => {
    if (url.endsWith('/sessions/resume') || url.endsWith('/sessions')) return Response.json({ visitorToken: token, visitor: guest });
    if (url.includes('/messages') && options.method === 'GET') return Response.json({ ticket, messages: [message], nextCursor: 1, hasMore: false });
    if (url.endsWith('/messages')) return Response.json({ message: { ...message, body: body.body } }, { status: 201 });
    if (url.endsWith('/tickets')) return Response.json({ ticket, messages: [message] }, { status: 201 });
    if (url.includes('/tickets?')) return Response.json({ tickets: [ticket], hasMore: false, nextCursor: null });
    return Response.json({ ok: true });
  };
  globalThis.fetch = async (url, options) => {
    assert.ok(String(url).startsWith('https://support.test/websites/api/v1/'));
    assert.equal(options.headers.authorization, 'Bearer ' + key);
    assert.equal(options.headers['X-Support-Origin'], 'https://cdek-fm.test');
    assert.equal(options.redirect, 'error');
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url: String(url), options, body });
    return respond(String(url), options, body);
  };
});
after(() => { globalThis.fetch = realFetch; database().close(); });

test('bridge rejects unconfigured keys and never exposes credentials', async () => {
  delete env.CDEK_SUPPORT_PLATFORM_KEY;
  const result = await call('session', { name: 'Guest' }, { cookie: '' });
  assert.equal(result.status, 503);
  assert.equal(requests.length, 0);
  assert.ok(!(await result.text()).includes(key));
});
test('bridge proof signs the configured canonical origin and binds its challenge', async () => {
  const response = await proof(new Request('https://unexpected.test/.well-known/support-bridge.json?challenge=fixture-challenge'));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.origin, 'https://cdek-fm.test');
  assert.equal(result.proof, createHmac('sha256', createHash('sha256').update(key).digest('hex')).update('fixture-challenge\nhttps://cdek-fm.test').digest('hex'));
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal((await proof(new Request('https://cdek-fm.test/.well-known/support-bridge.json?challenge=bad'))).status, 400);
});
test('guest creation puts its credential only in a Secure HttpOnly host cookie', async () => {
  const response = await call('session', { name: guest.name }, { cookie: '' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /__Host-cdek-support=.*Secure; HttpOnly; SameSite=Lax/);
  assert.deepEqual(await response.json(), { visitor: guest });
  assert.equal(requests[0].body.kind, 'guest');
  assert.equal('externalUserId' in requests[0].body, false);
});
test('cross-site writes and browser-supplied account identities are rejected', async () => {
  assert.equal((await call('session', { name: 'Guest' }, { origin: 'https://other.test' })).status, 403);
  assert.equal((await call('session', { name: 'Guest' }, { origin: '' })).status, 403);
  assert.equal((await call('session', { name: 'Guest', externalUserId: 'administrator' }, { cookie: '' })).status, 400);
  assert.equal(requests.length, 0);
});
test('ticket and message identifiers survive retries and the visitor token stays server-side', async () => {
  const id = randomUUID();
  for (let i = 0; i < 2; i++) {
    const response = await call('tickets', { subject: 'Test', body: 'A question', clientRequestId: id });
    assert.equal(response.status, 201);
    assert.ok(!(await response.text()).includes(token));
  }
  const sent = requests.filter(item => item.url.endsWith('/tickets'));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.clientRequestId, sent[1].body.clientRequestId);
  assert.equal(sent[0].options.headers['X-Support-Session'], token);
  assert.equal((await call('tickets/1/messages', { body: 'Follow-up', clientMessageId: id })).status, 201);
  assert.equal((await call('tickets/1/messages?after=0')).status, 200);
});
test('foreign tickets remain inaccessible and invalid message cursors are rejected', async () => {
  const original = respond;
  respond = (url, options, body) => url.includes('/tickets/2/') ? Response.json({ error: 'Private' }, { status: 404 }) : original(url, options, body);
  assert.equal((await call('tickets/2/messages')).status, 404);
  assert.equal((await call('tickets/1/messages?after=1%26admin=true')).status, 400);
  assert.equal((await call('tickets', { subject: 'Test', body: 'Question', clientRequestId: randomUUID(), visitorId: 2 })).status, 400);
});
test('revoked integration keys do not clear an otherwise valid visitor cookie', async () => {
  respond = () => Response.json({ code: 'INTEGRATION_UNAUTHORIZED', error: key }, { status: 401 });
  const response = await call('session');
  assert.equal(response.status, 502);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.ok(!(await response.text()).includes(key));
});
test('invalid visitor sessions are distinguished from integration failures and cleared', async () => {
  respond = () => Response.json({ code: 'SESSION_INVALID' }, { status: 401 });
  const response = await call('session');
  assert.equal(response.status, 401);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});
test('upstream service failures do not tell visitors to change valid form data', async () => {
  respond = () => Response.json({ error: 'Сайт ещё не подтвердил регламент интеграции' }, { status: 503 });
  const response = await call('session', { name: 'Guest' }, { cookie: '' });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, 'Поддержка временно недоступна. Повторите попытку позже.');
  assert.equal(response.headers.get('set-cookie'), null);
});
test('oversized, malformed and internal upstream data never reach the browser', async () => {
  respond = () => new Response('x'.repeat(1024 * 1024 + 1));
  assert.equal((await call('session')).status, 502);
  const original = (url) => url.endsWith('/sessions/resume') ? Response.json({ visitorToken: token, visitor: guest }) : Response.json({
    ticket, messages: [{ ...message, thread: 'escalation', body: 'Private escalation' }], nextCursor: 1, hasMore: false });
  respond = original;
  const response = await call('tickets/1/messages');
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes('Private escalation'));
});
test('recovery restores a guest and logout clears only this browser credential', async () => {
  assert.equal((await call('session/recover', { recoveryCode: token }, { cookie: '' })).status, 200);
  const code = await call('session/recovery-code', {});
  assert.equal((await code.json()).recoveryCode, token);
  const response = await call('session/logout', {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(requests.some(item => item.url.endsWith('/sessions/revoke')), false);
});
test('creating guest sessions is rate limited in persistent storage', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await call('session', { name: 'Guest' }, { cookie: '' })).status, 200);
  const response = await call('session', { name: 'Guest' }, { cookie: '' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '60');
});
