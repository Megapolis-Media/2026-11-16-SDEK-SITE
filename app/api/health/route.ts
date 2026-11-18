import { env } from 'cloudflare:workers';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (!env.DB) throw new Error('Missing database');
    // Preparing this bounded query checks all required tables/columns without
    // counting or returning private records. A partial migration is unhealthy.
    await env.DB.prepare(`SELECT
      studio.content, studio.revision, studio.updated_at,
      sessions.token_hash, sessions.password_version, sessions.expires_at,
      attempts.client_key, attempts.attempts, attempts.expires_at,
      chat.id, chat.client_key, chat.body, chat.created_at, chat.author_key, chat.author_name,
      chat.editorial, chat.thread_id, chat.parent_id, chat.image_key, chat.image_type,
      chat.image_digest, chat.image_width, chat.image_height,
      moderation.revision, tracks.id, tracks.author_key, tracks.author_name,
      tracks.title, tracks.artist, tracks.phase, tracks.created_at, tracks.accepted_at, tracks.client_key,
      tickets.id, tickets.number, tickets.email, tickets.description,
      tickets.status, tickets.created_at, tickets.updated_at,
      delivery.ticket_id, delivery.channel, delivery.state, delivery.attempts, delivery.updated_at, delivery.error,
      support.email
      FROM site_studio studio, studio_session sessions, studio_login_attempt attempts,
        chat_message chat, chat_moderation moderation, track_request tracks,
        support_ticket tickets, support_delivery delivery, support_settings support
      LIMIT 0`).all();
    await env.DB.prepare('SELECT author_key, day, used FROM chat_photo_daily LIMIT 0').all();
    await env.DB.prepare('SELECT id, bytes FROM local_upload_usage LIMIT 0').all();
    const guards = await env.DB.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('chat_photo_daily_guard', 'chat_photo_daily_count')").first<number>('count');
    if (guards !== 2) throw new Error('Missing photo quota guards');
    await env.DB.prepare('SELECT client_key, attempts, expires_at FROM support_bridge_rate LIMIT 0').all();
    return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
