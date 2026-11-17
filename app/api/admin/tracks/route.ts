import { env } from 'cloudflare:workers';
import { uuid } from '../../../chat-types';
import { mediaType, readBytes } from '../../../server/chat';
import { isEditor, json, sameOrigin } from '../../../server/studio';
import { withApiErrors } from '../../../server/api-errors';

export const dynamic = 'force-dynamic';

async function acceptTrack(request: Request) {
  if (!sameOrigin(request) || !(await isEditor())) return json({}, 403);
  if (!env.DB) return json({}, 503);
  if (mediaType(request) !== 'application/json') return json({}, 415);
  let data: { id?: unknown; accepted?: unknown };
  try { data = JSON.parse(new TextDecoder().decode(await readBytes(request, 1024))); }
  catch (error) { return json({}, error instanceof RangeError ? 413 : 400); }
  if (!data || typeof data.id !== 'string' || !uuid.test(data.id) || typeof data.accepted !== 'boolean') return json({}, 400);
  const updated = await env.DB.prepare('UPDATE track_request SET accepted_at = CASE WHEN ?1 IS NULL THEN NULL ELSE COALESCE(accepted_at, ?1) END WHERE id = ?2 RETURNING accepted_at AS acceptedAt')
    .bind(data.accepted ? Date.now() : null, data.id).first();
  return updated ? json(updated) : json({}, 404);
}

export const PATCH = withApiErrors(acceptTrack, 'Не удалось сохранить заявку. Попробуйте ещё раз.');
