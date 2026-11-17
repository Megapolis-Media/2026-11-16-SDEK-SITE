import { env } from 'cloudflare:workers';
import { uuid } from '../../chat-types';
import { cleanText, readBytes, visitor } from '../../server/chat';
import { json, publicEdition, readStudio, sameOrigin } from '../../server/studio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const db = env.DB;
  if (!db) return json({ error: 'Заявки временно недоступны' }, 503);
  if (!sameOrigin(request)) return json({}, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return json({}, 415);
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(new TextDecoder().decode(await readBytes(request, 4096))); }
  catch { return json({ error: 'Проверьте данные заявки' }, 400); }
  if (!payload || typeof payload.id !== 'string' || !uuid.test(payload.id) ||
    typeof payload.client !== 'string' || !uuid.test(payload.client)) return json({}, 400);
  const title = cleanText(payload.title, 120);
  const artist = cleanText(payload.artist ?? '', 120);
  const name = cleanText(payload.authorName ?? '', 40);
  if (!title || artist === null || name === null) return json({ error: 'Укажите название песни' }, 400);

  const author = await visitor(request, payload.client, name);
  const duplicate = () => db.prepare('SELECT id FROM track_request WHERE id = ? AND author_key = ? AND title = ? AND artist = ?')
    .bind(payload.id, author.id, title, artist).first();
  if (await duplicate()) return json({ id: payload.id });
  const { edition, phase } = publicEdition(await readStudio());
  if (!edition.tracksEnabled) return json({ error: 'Приём заявок сейчас закрыт' }, 403);
  const now = Date.now();
  const inserted = await db.prepare(`INSERT INTO track_request (id, author_key, author_name, title, artist, phase, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
    WHERE (SELECT COUNT(*) FROM track_request WHERE author_key = ?2 AND created_at > ?8) < 4
    ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(payload.id, author.id, author.name, title, artist, phase, now, now - 60_000).first();
  if (inserted) return json({ id: payload.id }, 201);
  return (await duplicate()) ? json({ id: payload.id }) : json({ error: 'Попробуйте чуть позже' }, 429);
}
