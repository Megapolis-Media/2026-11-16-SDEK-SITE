import { env } from 'cloudflare:workers';
import { type SupportDelivery, type SupportStatus, type SupportTicket } from '../support-types';
import { readBytes } from './chat';
import { json } from './studio';

const ticketFields = 'number, id, email, description, status, created_at AS createdAt, updated_at AS updatedAt';
const ticketPageSize = 30;

function database() {
  if (!env.DB) throw new Error('Support database is unavailable');
  return env.DB;
}

export async function readSupportBody(request: Request): Promise<{ body: unknown } | { error: Response }> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return { error: json({ error: 'Ожидается запрос в формате JSON.' }, 415) };
  }
  try {
    return { body: JSON.parse(new TextDecoder().decode(await readBytes(request, 24_000))) };
  } catch (error) {
    return { error: error instanceof RangeError
      ? json({ error: 'Заявка слишком длинная.' }, 413)
      : json({ error: 'Проверьте поля заявки.' }, 400) };
  }
}

export function parseSupportCursor(value: string | null, fallback: number) {
  if (value === null) return fallback;
  if (!/^\d{1,16}$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) ? cursor : null;
}

export function supportTicketById(id: string) {
  return database().prepare(`SELECT ${ticketFields} FROM support_ticket WHERE id = ?`).bind(id).first<SupportTicket>();
}

export async function createSupportTicket(id: string, email: string, description: string) {
  const db = database();
  const now = Date.now();
  const [insert] = await db.batch([
    db.prepare(`INSERT INTO support_ticket (id, email, description, created_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?4
      WHERE (SELECT COUNT(*) FROM support_ticket WHERE email = ?2 AND created_at > ?5) < 5
        AND (SELECT COUNT(*) FROM support_ticket WHERE created_at > ?6) < 120
      ON CONFLICT(id) DO NOTHING RETURNING id`)
      .bind(id, email, description, now, now - 10 * 60_000, now - 60_000),
    db.prepare(`INSERT INTO support_delivery (ticket_id, channel, updated_at)
      SELECT ?1, channel, ?2 FROM (SELECT 'email' AS channel UNION ALL SELECT 'helpdesk')
      WHERE EXISTS (
        SELECT 1 FROM support_ticket WHERE id = ?1 AND created_at = ?2 AND email = ?3 AND description = ?4
      )
      ON CONFLICT(ticket_id, channel) DO NOTHING`).bind(id, now, email, description),
  ]);
  const ticket = await supportTicketById(id);
  if (!ticket) return { state: 'limited' } as const;
  if (ticket.email !== email || ticket.description !== description) return { state: 'conflict' } as const;
  return { state: 'saved', ticket, created: insert.results.length > 0 } as const;
}

export async function supportInbox(before: number, status?: SupportStatus) {
  const db = database();
  const [page, volumes] = await Promise.all([
    db.prepare(`SELECT ${ticketFields} FROM support_ticket
      WHERE number < ? ${status ? 'AND status = ?' : ''} ORDER BY number DESC LIMIT ?`)
      .bind(before, ...(status ? [status] : []), ticketPageSize + 1).all<SupportTicket>(),
    db.prepare('SELECT status, COUNT(*) AS count FROM support_ticket GROUP BY status')
      .all<{ status: SupportStatus; count: number }>(),
  ]);
  const tickets = page.results.slice(0, ticketPageSize);
  const counts = { new: 0, in_progress: 0, resolved: 0 };
  for (const row of volumes.results) counts[row.status] = row.count;
  const deliveries = new Map<string, SupportDelivery[]>();
  if (tickets.length) {
    const rows = await db.prepare(`SELECT ticket_id AS ticketId, channel, state, attempts, updated_at AS updatedAt, error
      FROM support_delivery WHERE ticket_id IN (${tickets.map(() => '?').join(',')})`)
      .bind(...tickets.map(ticket => ticket.id)).all<SupportDelivery & { ticketId: string }>();
    for (const { ticketId, ...delivery } of rows.results) {
      const list = deliveries.get(ticketId) ?? [];
      if (!deliveries.has(ticketId)) deliveries.set(ticketId, list);
      list.push(delivery);
    }
  }
  return {
    tickets: tickets.map(ticket => ({ ...ticket, deliveries: deliveries.get(ticket.id) ?? [] })),
    nextBefore: page.results.length > ticketPageSize ? tickets.at(-1)!.number : null,
    counts,
  };
}

export async function takeSupportTickets(after: number, limit: number) {
  const page = await database().prepare(`SELECT ${ticketFields} FROM support_ticket WHERE number > ? ORDER BY number LIMIT ?`)
    .bind(after, limit + 1).all<SupportTicket>();
  const tickets = page.results.slice(0, limit);
  return { tickets, nextAfter: tickets.at(-1)?.number ?? after, hasMore: page.results.length > limit };
}

export async function changeSupportStatus({ id, status, updatedAt }: Pick<SupportTicket, 'id' | 'status' | 'updatedAt'>) {
  const ticket = await database().prepare(`UPDATE support_ticket
    SET status = ?1, updated_at = MAX(updated_at + 1, ?2)
    WHERE id = ?3 AND updated_at = ?4 AND status <> ?1 RETURNING ${ticketFields}`)
    .bind(status, Date.now(), id, updatedAt).first<SupportTicket>() ?? await supportTicketById(id);
  if (!ticket) return json({ error: 'Заявка не найдена.' }, 404);
  if (ticket.status !== status) return json({ error: 'Статус уже изменился. Проверьте актуальную заявку.', ticket }, 409);
  return json({ ticket });
}

export async function supportNotificationEmail() {
  return await database().prepare('SELECT email FROM support_settings WHERE id = 1').first<string>('email') ?? '';
}

export async function saveSupportNotificationEmail(email: string) {
  await database().prepare('INSERT INTO support_settings (id, email) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email')
    .bind(email).run();
}
