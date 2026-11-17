import { env } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { supportChannels, supportEmail, type SupportChannel, type SupportTicket } from '../support-types';
import { supportNotificationEmail } from './support';

function configuredToken(value?: string) {
  const token = value?.trim() ?? '';
  return /^[^\s,]{32,256}$/.test(token) ? token : '';
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest();
}

export function supportIntegrationAuth(request: Request) {
  const token = configuredToken(env.CDEK_SUPPORT_API_TOKEN);
  if (!token) return 'unavailable';
  const candidate = /^Bearer ([^\s,]{32,256})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  return candidate && timingSafeEqual(sha256(candidate), sha256(token)) ? 'allowed' : 'denied';
}

function webhookUrl(value?: string) {
  try {
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.href : '';
  } catch {
    return '';
  }
}

async function deliverySettings() {
  const email = await supportNotificationEmail();
  const from = supportEmail.safeParse(env.CDEK_SUPPORT_EMAIL_FROM);
  const mailKey = env.CDEK_SUPPORT_RESEND_KEY?.trim() ?? '';
  const url = webhookUrl(env.CDEK_SUPPORT_HELPDESK_URL);
  const webhookToken = configuredToken(env.CDEK_SUPPORT_HELPDESK_TOKEN);
  return {
    email,
    mail: from.success && /^[^\s,]{1,256}$/.test(mailKey) ? { from: from.data, key: mailKey } : null,
    hook: url && webhookToken ? { url, token: webhookToken } : null,
    apiReady: Boolean(configuredToken(env.CDEK_SUPPORT_API_TOKEN)),
  };
}

export async function supportDeliveryOverview() {
  const { email, mail, hook, apiReady } = await deliverySettings();
  return { email, mailReady: Boolean(mail), helpdeskReady: Boolean(hook), apiReady };
}

type OutboundRequest = { url: string; token: string; key: string; body: object };

async function sendDelivery(ticketId: string, channel: SupportChannel, request: OutboundRequest, retry: boolean) {
  const db = env.DB;
  if (!db) return;
  const now = Date.now();
  // Only the current claimant can record a delivery attempt.
  const attempt = await db.prepare(`UPDATE support_delivery
    SET state = 'sending', attempts = attempts + 1, updated_at = ?1, error = NULL
    WHERE ticket_id = ?2 AND channel = ?3
      AND (state = 'pending' OR (?4 = 1 AND (state = 'failed' OR (state = 'sending' AND updated_at < ?5))))
    RETURNING attempts`).bind(now, ticketId, channel, Number(retry), now - 30_000).first<number>('attempts');
  if (attempt === null) return;
  let error: string | null = null;
  try {
    const result = await fetch(request.url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + request.token,
        'content-type': 'application/json',
        'idempotency-key': request.key,
      },
      body: JSON.stringify(request.body),
      redirect: 'error',
      signal: AbortSignal.timeout(3500),
    });
    if (!result.ok) error = 'http_' + result.status;
    await result.body?.cancel().catch(() => {});
  } catch (reason) {
    error = reason instanceof Error && reason.name === 'TimeoutError' ? 'timeout' : 'network';
  }
  await db.prepare(`UPDATE support_delivery SET state = ?, updated_at = ?, error = ?
    WHERE ticket_id = ? AND channel = ? AND state = 'sending' AND attempts = ?`)
    .bind(error ? 'failed' : 'sent', Date.now(), error, ticketId, channel, attempt).run();
}

export async function deliverSupportTicket(ticket: SupportTicket, retry = false) {
  const { email, mail, hook } = await deliverySettings();
  const key = 'cdek-fm-support/' + ticket.id;
  const requests: Partial<Record<SupportChannel, OutboundRequest>> = {};
  if (email && mail) {
    requests.email = {
      url: 'https://api.resend.com/emails',
      token: mail.key,
      key: key + '/email/' + sha256(mail.from + '\n' + email).toString('hex').slice(0, 20),
      body: {
        from: 'CDEK FM <' + mail.from + '>',
        to: [email],
        reply_to: ticket.email,
        subject: 'CDEK FM · Заявка №' + ticket.number,
        text: 'Заявка №' + ticket.number + '\nПочта для ответа: ' + ticket.email + '\n\n' + ticket.description,
      },
    };
  }
  if (hook) {
    requests.helpdesk = {
      url: hook.url,
      token: hook.token,
      key,
      body: {
        event: 'ticket.created',
        source: 'cdek-fm',
        ticket: { ...ticket, status: 'new', updatedAt: ticket.createdAt },
      },
    };
  }
  const deliveries = supportChannels.flatMap(channel => {
    const request = requests[channel];
    return request ? [sendDelivery(ticket.id, channel, request, retry)] : [];
  });
  await Promise.all(deliveries);
}
