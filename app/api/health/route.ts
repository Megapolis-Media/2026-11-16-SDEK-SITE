import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!env.DB) throw new Error('Missing database');
    await env.DB.prepare('SELECT COUNT(*) AS count FROM studio_session').first();
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
