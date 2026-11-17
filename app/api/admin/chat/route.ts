import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { uuid } from '../../../chat-types';
import { listMessages, mediaType, messageById, readBytes } from '../../../server/chat';
import { isEditor, json, sameOrigin } from '../../../server/studio';
import { withApiErrors } from '../../../server/api-errors';

export const dynamic = 'force-dynamic';

const removal = z.union([
  z.object({ clear: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.string().regex(uuid)).min(1) }).strict(),
]);

async function readModeration(request: Request) {
  if (!sameOrigin(request) || !await isEditor()) return json({ error: 'Нужен доступ редакции.' }, 403);
  if (!env.DB) return json({ error: 'Чат временно недоступен.' }, 503);
  const before = new URL(request.url).searchParams.get('before');
  if (before !== null && !uuid.test(before)) return json({}, 400);
  const cursor = before ? await messageById(before) : null;
  if (before && !cursor) return json({}, 404);
  const page = await listMessages(
    cursor ? '(m.created_at < ? OR (m.created_at = ? AND m.id < ?))' : '1 = 1',
    cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : [], 36, false,
  );
  return json({ ...page, messages: page.messages.reverse() });
}

async function removeMessages(request: Request) {
  if (!sameOrigin(request) || !await isEditor()) return json({ error: 'Нужен доступ редакции.' }, 403);
  const { DB: db, BUCKET: bucket } = env;
  if (!db) return json({ error: 'Чат временно недоступен.' }, 503);
  if (mediaType(request) !== 'application/json') return json({}, 415);
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(await readBytes(request, 80_000))); }
  catch (error) { return json({}, error instanceof RangeError ? 413 : 400); }
  const parsed = removal.safeParse(raw);
  if (!parsed.success) return json({ error: 'Выберите сообщения для удаления.' }, 400);

  const statement = 'clear' in parsed.data
    ? db.prepare('DELETE FROM chat_message RETURNING image_key AS imageKey')
    : db.prepare(`WITH RECURSIVE removed(id) AS (
        SELECT id FROM chat_message WHERE id IN (SELECT value FROM json_each(?))
        UNION
        SELECT m.id FROM chat_message m JOIN removed r ON m.parent_id = r.id OR m.thread_id = r.id
      )
      DELETE FROM chat_message WHERE id IN (SELECT id FROM removed) RETURNING image_key AS imageKey`)
      .bind(JSON.stringify(parsed.data.ids));
  const [deleted] = await db.batch<{ imageKey: string | null }>([statement, db.prepare(`
    INSERT INTO chat_moderation (id, revision) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET revision = revision + 1`)]);

  const attachments = deleted.results.flatMap(row => row.imageKey ? [row.imageKey] : []);
  let attachmentsRemoved = true;
  if (bucket) {
    for (let start = 0; start < attachments.length; start += 1000) {
      try { await bucket.delete(attachments.slice(start, start + 1000)); }
      catch (error) { attachmentsRemoved = false; console.error('Chat attachment removal failed', error); }
    }
  } else attachmentsRemoved = attachments.length === 0;
  return json({ deleted: deleted.results.length, attachmentsRemoved });
}

export const GET = withApiErrors(readModeration, 'Не удалось загрузить сообщения. Попробуйте ещё раз.');
export const DELETE = withApiErrors(removeMessages, 'Не удалось удалить сообщения. Попробуйте ещё раз.');
