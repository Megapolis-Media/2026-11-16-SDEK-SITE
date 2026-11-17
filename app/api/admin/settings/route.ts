import { env } from 'cloudflare:workers';
import { isEditor, json, readStudio, sameOrigin } from '../../../server/studio';
import { mediaType, readBytes } from '../../../server/chat';
import { studioSchema } from '../../../studio-config';
import { withApiErrors } from '../../../server/api-errors';

export const dynamic = 'force-dynamic';

async function saveSettings(request: Request) {
  if (!sameOrigin(request) || !await isEditor()) return json({ error: 'Нужен доступ редакции.' }, 403);
  if (!env.DB) return json({ error: 'Хранилище недоступно.' }, 503);
  if (mediaType(request) !== 'application/json') return json({}, 415);
  let body: { studio?: unknown; revision?: number };
  try { body = JSON.parse(new TextDecoder().decode(await readBytes(request, 80_000))); }
  catch (error) {
    return error instanceof RangeError ? json({ error: 'Слишком много текста.' }, 413)
      : json({ error: 'Проверьте настройки.' }, 400);
  }
  if (!body || typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0) return json({}, 400);
  const draft = body.studio;
  const parsed = studioSchema.safeParse(draft && typeof draft === 'object' && !Array.isArray(draft) && !('contacts' in draft)
    ? { ...draft, contacts: (await readStudio()).studio.contacts } : draft);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля редактора.' }, 400);
  const content = JSON.stringify(parsed.data);
  const updatedAt = Date.now();
  const statement = body.revision
    ? env.DB.prepare('UPDATE site_studio SET content = ?1, revision = revision + 1, updated_at = ?2 WHERE id = 1 AND revision = ?3 RETURNING revision')
      .bind(content, updatedAt, body.revision)
    : env.DB.prepare('INSERT INTO site_studio (id, content, revision, updated_at) VALUES (1, ?1, 1, ?2) ON CONFLICT(id) DO NOTHING RETURNING revision')
      .bind(content, updatedAt);
  const saved = await statement.first<{ revision: number }>();
  if (!saved) return json({ error: 'Настройки уже изменились. Обновите страницу, чтобы увидеть опубликованный вариант.', current: await readStudio() }, 409);
  return json({ studio: parsed.data, revision: saved.revision, updatedAt });
}

export const PUT = withApiErrors(saveSettings, 'Не удалось сохранить настройки. Попробуйте ещё раз.');
