import { env } from 'cloudflare:workers';
import { maxImageBytes, messageLimit, uuid } from '../../chat-types';
import { chatModerationRevision, cleanText, hash, inspectImage, listMessages, messageById, presentMessage, readBytes, visitor } from '../../server/chat';
import { json, publicEdition, readStudio, sameOrigin } from '../../server/studio';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!env.DB) return json({ error: 'Чат временно недоступен' }, 503);
  const params = new URL(request.url).searchParams;
  const thread = params.get('thread');
  const before = params.get('before');
  if ([thread, before].some(value => value !== null && !uuid.test(value))) return json({}, 400);
  const moderation = thread ? 0 : await chatModerationRevision();
  const earlier = before ? await messageById(before) : null;
  if (before && (!earlier || earlier.threadId !== thread)) return json({}, 404);
  const cursor = earlier ? ' AND (m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : '';
  const args = earlier ? [earlier.createdAt, earlier.createdAt, earlier.id] : [];
  if (thread) {
    const root = await messageById(thread);
    if (!root || root.threadId) return json({}, 404);
    const result = await listMessages('m.thread_id = ?' + cursor, [thread, ...args], 36, false);
    return json({ root: presentMessage(root), replies: result.messages, older: result.older });
  }
  const [result, traffic] = await Promise.all([
    listMessages('m.thread_id IS NULL' + cursor, args, 30, true),
    before ? null : listMessages('1 = 1', [], 80, false),
  ]);
  return json({ ...result, traffic: traffic?.messages ?? [], moderation });
}

export async function POST(request: Request) {
  const { DB: db, BUCKET: bucket } = env;
  if (!db) return json({ error: 'Чат временно недоступен' }, 503);
  if (!sameOrigin(request)) return json({}, 403);
  const type = request.headers.get('content-type') ?? '';
  const multipart = type.startsWith('multipart/form-data;');
  if (!multipart && !type.startsWith('application/json')) return json({}, 415);
  let data: Record<string, unknown>;
  let file: File | null = null;
  try {
    const bytes = await readBytes(request, multipart ? maxImageBytes + 8192 : 4096);
    if (multipart) {
      const form = await new Response(bytes, { headers: { 'content-type': type } }).formData();
      data = Object.fromEntries(form.entries());
      if (data.image instanceof File && data.image.size) file = data.image;
    } else {
      data = JSON.parse(new TextDecoder().decode(bytes));
    }
  } catch (error) {
    return error instanceof RangeError ? json({ error: 'Картинка слишком большая' }, 413) : json({}, 400);
  }
  if (!data || typeof data.id !== 'string' || !uuid.test(data.id) ||
    typeof data.client !== 'string' || !uuid.test(data.client)) return json({}, 400);
  const parentId = data.parentId || null;
  if (parentId !== null && (typeof parentId !== 'string' || !uuid.test(parentId))) return json({}, 400);
  const id = data.id;
  const body = cleanText(data.body ?? '', messageLimit);
  const name = cleanText(data.authorName ?? '', 40);
  if (body === null || name === null || (!body && !file)) return json({ error: 'Добавьте сообщение или картинку' }, 400);
  const author = await visitor(request, data.client, name);
  const { edition } = publicEdition(await readStudio());
  if (!author.editorial && !edition.blocks.chat.visible && !edition.blocks['circuit-chat'].visible)
    return json({ error: 'Чат сейчас закрыт' }, 403);

  const parent = parentId ? await messageById(parentId) : null;
  if (parentId && !parent) return json({ error: 'Сообщение не найдено' }, 404);
  const thread = parent ? parent.threadId ?? parent.id : null;
  let imageBytes: ArrayBuffer | null = null;
  let details: ReturnType<typeof inspectImage> = null;
  let digest: string | null = null;
  if (file) {
    if (!bucket) return json({ error: 'Загрузка картинок временно недоступна' }, 503);
    if (file.size > maxImageBytes) return json({ error: 'Картинка слишком большая' }, 413);
    imageBytes = await file.arrayBuffer();
    details = inspectImage(imageBytes);
    if (!details) return json({ error: 'Выберите статичную картинку JPG, PNG или WebP' }, 415);
    digest = await hash(imageBytes);
  }

  const matching = () => db.prepare('SELECT id FROM chat_message WHERE id = ? AND author_key = ? AND body = ? AND parent_id IS ? AND image_digest IS ?')
    .bind(id, author.id, body, parentId, digest).first();
  if (await matching()) {
    const message = await messageById(id);
    if (message) return json(presentMessage(message));
  }
  const now = Date.now();
  const permitted = await db.prepare(`SELECT 1 WHERE NOT EXISTS (
    SELECT 1 FROM chat_message WHERE author_key = ?1 AND created_at > ?2
  ) AND (SELECT COUNT(*) FROM chat_message WHERE client_key = ?3 AND created_at > ?4) < 60`)
    .bind(author.id, now - 1200, author.fingerprint, now - 60_000).first();
  if (!permitted) return json({ error: 'Подождите немного и отправьте снова' }, 429);
  const imageKey = details && imageBytes ? 'chat/' + id + '/' + crypto.randomUUID() : null;
  let inserted: unknown = null;
  try {
    if (bucket && details && imageBytes && imageKey)
      await bucket.put(imageKey, imageBytes, { httpMetadata: { contentType: details.type } });
    inserted = await db.prepare(`INSERT INTO chat_message
      (id, client_key, body, created_at, author_key, author_name, editorial, parent_id, thread_id, image_key, image_type, image_digest, image_width, image_height)
      SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
      WHERE NOT EXISTS (SELECT 1 FROM chat_message WHERE author_key = ?5 AND created_at > ?15)
      AND (SELECT COUNT(*) FROM chat_message WHERE client_key = ?2 AND created_at > ?16) < 60
      AND (?8 IS NULL OR EXISTS (SELECT 1 FROM chat_message WHERE id = ?8))
      ON CONFLICT(id) DO NOTHING RETURNING id`)
      .bind(id, author.fingerprint, body, now, author.id, author.name, Number(author.editorial), parentId, thread, imageKey,
        details?.type ?? null, digest, details?.width ?? null, details?.height ?? null, now - 1200, now - 60_000).first();
  } catch (error) {
    console.error('Chat delivery failed', error);
    return json({ error: 'Связь прервалась. Попробуйте отправить снова' }, 503);
  } finally {
    if (!inserted && bucket && imageKey) {
      // Retain an attachment if an ambiguous write failure occurred after the commit.
      try {
        const kept = await db.prepare('SELECT id FROM chat_message WHERE id = ? AND image_key = ?').bind(id, imageKey).first();
        if (!kept) await bucket.delete(imageKey);
      } catch (error) { console.error('Chat attachment cleanup failed', error); }
    }
  }
  if (!inserted && !(await matching())) {
    if (parentId && !await messageById(parentId)) return json({ error: 'Сообщение не найдено' }, 404);
    return json({ error: 'Подождите немного и отправьте снова' }, 429);
  }
  const message = await messageById(id);
  return message ? json(presentMessage(message), inserted ? 201 : 200) : json({}, 503);
}
