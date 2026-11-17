import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { supportEmail, supportId, supportStatus, supportStatusChange } from '../../../support-types';
import { isEditor, json, sameOrigin } from '../../../server/studio';
import { changeSupportStatus, parseSupportCursor, readSupportBody, saveSupportNotificationEmail, supportInbox,
  supportTicketById } from '../../../server/support';
import { deliverSupportTicket, supportDeliveryOverview } from '../../../server/support-delivery';

export const dynamic = 'force-dynamic';

const change = z.discriminatedUnion('action', [
  supportStatusChange.extend({ action: z.literal('status') }),
  z.strictObject({ action: z.literal('email'), email: z.union([z.literal(''), supportEmail]) }),
  z.strictObject({ action: z.literal('retry'), id: supportId }),
]);

export async function GET(request: Request) {
  try {
    if (!await isEditor()) return json({ error: 'Нужен доступ редакции.' }, 403);
    if (!env.DB) return json({ error: 'Хранилище недоступно.' }, 503);
    const params = new URL(request.url).searchParams;
    const before = parseSupportCursor(params.get('before'), Number.MAX_SAFE_INTEGER);
    const status = supportStatus.optional().safeParse(params.get('status') ?? undefined);
    if (before === null || before < 1 || !status.success) return json({ error: 'Проверьте фильтр.' }, 400);
    const [page, settings] = await Promise.all([supportInbox(before, status.data), supportDeliveryOverview()]);
    return json({ ...page, settings });
  } catch {
    return json({ error: 'Не удалось загрузить заявки.' }, 503);
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request) || !await isEditor()) return json({ error: 'Нужен доступ редакции.' }, 403);
    if (!env.DB) return json({ error: 'Хранилище недоступно.' }, 503);
    const input = await readSupportBody(request);
    if ('error' in input) return input.error;
    const parsed = change.safeParse(input.body);
    if (!parsed.success) return json({ error: 'Проверьте email и параметры заявки.' }, 400);
    const action = parsed.data;
    if (action.action === 'status') return await changeSupportStatus(action);
    if (action.action === 'email') {
      await saveSupportNotificationEmail(action.email);
      return json({ settings: await supportDeliveryOverview() });
    }
    const ticket = await supportTicketById(action.id);
    if (!ticket) return json({ error: 'Заявка не найдена.' }, 404);
    await deliverSupportTicket(ticket, true);
    return json({ ok: true });
  } catch {
    return json({ error: 'Не удалось выполнить действие. Попробуйте ещё раз.' }, 503);
  }
}
