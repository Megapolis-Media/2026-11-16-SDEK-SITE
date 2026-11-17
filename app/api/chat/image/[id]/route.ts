import { env } from 'cloudflare:workers';
import { uuid } from '../../../../chat-types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.test(id) || !env.DB || !env.BUCKET) return new Response(null, { status: 404 });
  const row = await env.DB.prepare('SELECT image_key AS key, image_type AS type FROM chat_message WHERE id = ?')
    .bind(id).first<{ key: string | null; type: string | null }>();
  if (!row?.key || !row.type || !['image/jpeg', 'image/png', 'image/webp'].includes(row.type)) return new Response(null, { status: 404 });
  const object = await env.BUCKET.get(row.key);
  if (!object) return new Response(null, { status: 404 });
  const headers = {
    'content-type': row.type, 'content-length': String(object.size), 'cache-control': 'public, no-cache',
    'x-content-type-options': 'nosniff', 'content-disposition': 'inline',
    'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin',
    etag: object.httpEtag,
  };
  if (request.headers.get('if-none-match') === object.httpEtag) {
    const { 'content-length': _, ...cached } = headers;
    return new Response(null, { status: 304, headers: cached });
  }
  return new Response(object.body, { headers });
}
