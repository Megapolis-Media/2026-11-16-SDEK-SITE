import { env } from 'cloudflare:workers';
import { createHash, createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { isEditor, json, sameOrigin } from './studio';
import { readSupportBody } from './support';

const cookieName = '__Host-cdek-support';
const secret = z.string().regex(/^[A-Za-z0-9_-]{20,512}$/);
const visitorSchema = z.object({ id: z.number().int().positive(), kind: z.literal('guest'), name: z.string() });
const sessionSchema = z.object({ visitorToken: secret, visitor: visitorSchema });
const ticketSchema = z.object({ id: z.number().int().positive(), ticketId: z.string(), status: z.string(), subject: z.string() });
const messageSchema = z.object({ id: z.number().int().positive(), body: z.string(), authorName: z.string(),
  authorType: z.string(), thread: z.literal('client'), createdAt: z.string() });
const messagesSchema = z.object({ ticket: ticketSchema, messages: z.array(messageSchema).max(100),
  nextCursor: z.number().int().nonnegative(), hasMore: z.boolean() });
const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(4000);

class BridgeError extends Error {
  constructor(public status: number, message: string, public code = '') { super(message); }
}

function configuration() {
  const key = env.CDEK_SUPPORT_PLATFORM_KEY?.trim() ?? '';
  const base = new URL(env.CDEK_SUPPORT_PLATFORM_URL || 'https://help.megapolis.media/websites/api/v1');
  const origin = new URL(env.CDEK_SUPPORT_SITE_ORIGIN || 'https://cdek-fm.ru');
  if (!secret.safeParse(key).success || [base, origin].some(url => url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    || origin.pathname !== '/') throw new BridgeError(503, 'Поддержка пока не подключена. Попробуйте позже.');
  return { key, base: base.href.replace(/\/$/, ''), origin: origin.origin };
}

async function upstream(path: string, method = 'GET', body?: object, token?: string): Promise<unknown> {
  const config = configuration();
  let response: Response;
  try {
    response = await fetch(config.base + path, { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { authorization: 'Bearer ' + config.key, 'X-Support-Origin': config.origin, accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { 'X-Support-Session': token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { throw new BridgeError(502, 'Не удалось связаться с поддержкой. Повторите попытку.'); }
  let data: unknown;
  try {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    let length = 0;
    const parts: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 1024 * 1024) { await reader.cancel(); throw new Error('Oversized response'); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new BridgeError(502, 'Поддержка вернула некорректный ответ. Повторите попытку.'); }
  if (!response.ok) {
    const code = z.object({ code: z.string().max(80).optional() }).safeParse(data);
    const value = code.success ? code.data.code ?? '' : '';
    if (value === 'INTEGRATION_UNAUTHORIZED') throw new BridgeError(502, 'Подключение поддержки требует проверки администратором.', value);
    if (value === 'SESSION_INVALID') throw new BridgeError(401, 'Сессия поддержки завершена. Укажите имя или восстановите переписку.', value);
    const status = response.status >= 500 ? 502 : response.status;
    throw new BridgeError(status, status === 429 ? 'Слишком много запросов. Подождите немного.' :
      status >= 500 ? 'Поддержка временно недоступна. Повторите попытку позже.' :
      status === 404 ? 'Обращение не найдено или недоступно.' : status === 409 ? 'Обращение изменилось или уже закрыто. Обновите переписку.' :
      status === 401 || status === 403 ? 'Нет доступа к обращению.' : 'Не удалось выполнить запрос поддержки. Проверьте данные.');
  }
  return data;
}

function setCookie(response: Response, token: string, age?: number) {
  response.headers.set('set-cookie', `${cookieName}=${token};${age === undefined ? '' : ` Max-Age=${age};`} Path=/; Secure; HttpOnly; SameSite=Lax`);
  return response;
}

async function current() {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value || !secret.safeParse(value).success) throw new BridgeError(401, 'Укажите имя, чтобы обратиться в поддержку.', 'SESSION_INVALID');
  const result = received(sessionSchema, await upstream('/sessions/resume', 'POST', { token: value }));
  return result;
}

function received<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BridgeError(502, 'Поддержка вернула некорректные данные. Повторите попытку.');
  return result.data;
}

async function limit(key: string, maximum: number) {
  if (!env.DB) throw new BridgeError(503, 'Поддержка временно недоступна.');
  const now = Date.now();
  const client = createHash('sha256').update('support-bridge:' + key).digest('hex');
  const result = await env.DB.batch([
    env.DB.prepare('DELETE FROM support_bridge_rate WHERE expires_at <= ?').bind(now),
    env.DB.prepare(`INSERT INTO support_bridge_rate (client_key, attempts, expires_at) VALUES (?, 1, ?)
      ON CONFLICT(client_key) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ? RETURNING attempts`).bind(client, now + 60_000, maximum),
  ]);
  if (!result[1].results.length) throw new BridgeError(429, 'Слишком много запросов. Подождите минуту.');
}

export async function bridgeProof(request: Request) {
  try {
    const config = configuration();
    const challenge = new URL(request.url).searchParams.get('challenge') ?? '';
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(challenge)) return json({ error: 'Некорректный challenge.' }, 400);
    const hash = createHash('sha256').update(config.key).digest('hex');
    return json({ protocol: 'support-websites', version: '1.0', origin: config.origin, challenge,
      capabilities: ['identity', 'tickets', 'messages', 'polling', 'guest-recovery'],
      proof: createHmac('sha256', hash).update(challenge + '\n' + config.origin).digest('hex') });
  } catch { return json({ error: 'Поддержка пока не подключена.' }, 503); }
}

export async function handleBridge(request: Request, path: string[]) {
  try {
    configuration();
    if (!sameOrigin(request) || (request.method === 'POST' && !request.headers.get('origin'))) return json({}, 403);
    const action = path.join('/');
    const get = request.method === 'GET';
    const id = path[1];
    const ticketPath = path[0] === 'tickets' && /^[1-9]\d{0,14}$/.test(id ?? '');
    if (action === 'register' && !get) {
      if (!await isEditor()) return json({}, 403);
      const config = configuration();
      await upstream('/register', 'POST', { origin: config.origin, name: 'CDEK FM' });
      return json({ ok: true });
    }
    if (action === 'session/logout' && !get) return setCookie(json({ ok: true }), '', 0);
    await limit('global', 1200);
    if (!get && ['session', 'session/recover'].includes(action))
      await limit('ip:' + (request.headers.get('cf-connecting-ip') || 'unknown'), 30);
    let body: unknown;
    if (!get) {
      const input = await readSupportBody(request);
      if ('error' in input) return input.error;
      body = input.body;
    }
    if (action === 'session' && !get) {
      const input = z.object({ name: z.string().trim().min(1).max(120) }).strict().parse(body);
      const old = (await cookies()).get(cookieName)?.value;
      let token: string | undefined;
      if (old && secret.safeParse(old).success) {
        try { token = (await current()).visitorToken; }
        catch (error) { if (!(error instanceof BridgeError && error.code === 'SESSION_INVALID')) throw error; }
      }
      const session = received(sessionSchema, await upstream('/sessions', 'POST', { kind: 'guest', name: input.name }, token));
      return setCookie(json({ visitor: session.visitor }), session.visitorToken);
    }
    if (action === 'session/recover' && !get) {
      const { recoveryCode } = z.object({ recoveryCode: secret }).strict().parse(body);
      const session = received(sessionSchema, await upstream('/sessions/resume', 'POST', { token: recoveryCode }));
      return setCookie(json({ visitor: session.visitor }), session.visitorToken);
    }
    const session = await current();
    const token = session.visitorToken;
    await limit('session:' + token, 120);
    if (action === 'session' && get) return setCookie(json({ visitor: session.visitor }), token);
    if (action === 'session/recovery-code' && !get) return json({ recoveryCode: token });
    if (action === 'session/forget' && !get) {
      await upstream('/sessions/revoke', 'POST', {}, token);
      return setCookie(json({ ok: true }), '', 0);
    }
    if (action === 'tickets' && get) {
      const params = new URL(request.url).searchParams;
      const before = params.get('before');
      if (before !== null && !/^[1-9]\d{0,14}$/.test(before)) return json({}, 400);
      const result = received(z.object({ tickets: z.array(ticketSchema).max(100), hasMore: z.boolean(), nextCursor: z.number().int().positive().nullable() }),
        await upstream('/tickets?limit=30' + (before ? '&before=' + before : ''), 'GET', undefined, token));
      return json(result);
    }
    if (action === 'tickets' && !get) {
      const input = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(12_000), clientRequestId: uuid,
        contactEmail: z.string().trim().email().max(254).optional() }).strict().parse(body);
      const result = received(z.object({ ticket: ticketSchema, messages: z.array(messageSchema).max(100) }), await upstream('/tickets', 'POST', input, token));
      return json(result, 201);
    }
    if (ticketPath && path.length === 3 && path[2] === 'messages') {
      if (get) {
        const after = new URL(request.url).searchParams.get('after') ?? '0';
        if (!/^\d{1,15}$/.test(after)) return json({}, 400);
        return json(received(messagesSchema, await upstream(`/tickets/${id}/messages?after=${after}&limit=100`, 'GET', undefined, token)));
      }
      const input = z.object({ body: text, clientMessageId: uuid }).strict().parse(body);
      const result = received(z.object({ message: messageSchema }), await upstream(`/tickets/${id}/messages`, 'POST', input, token));
      return json(result, 201);
    }
    if (ticketPath && path.length === 3 && path[2] === 'rating' && !get) {
      const input = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).strict().parse(body);
      await upstream(`/tickets/${id}/rating`, 'POST', input, token);
      return json({ ok: true });
    }
    return json({}, 404);
  } catch (error) {
    if (error instanceof BridgeError) {
      const response = json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
      if (error.status === 429) response.headers.set('retry-after', '60');
      return error.code === 'SESSION_INVALID' ? setCookie(response, '', 0) : response;
    }
    // Never forward raw upstream objects, exception messages or credentials.
    if (error instanceof z.ZodError) return json({ error: 'Проверьте данные запроса или повторите загрузку переписки.' }, 400);
    return json({ error: 'Не удалось связаться с поддержкой. Повторите попытку.' }, 502);
  }
}
