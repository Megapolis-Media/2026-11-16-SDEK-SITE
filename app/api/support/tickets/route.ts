import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { supportDescriptionLimit, supportEmail, supportId } from '../../../support-types';
import { cleanText } from '../../../server/chat';
import { json, sameOrigin } from '../../../server/studio';
import { createSupportTicket, readSupportBody } from '../../../server/support';
import { deliverSupportTicket } from '../../../server/support-delivery';

export const dynamic = 'force-dynamic';

const submission = z.strictObject({
  id: supportId,
  email: supportEmail,
  description: z.string().max(supportDescriptionLimit),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({}, 403);
  if (!env.DB) return json({ error: 'Поддержка временно недоступна.' }, 503);
  const input = await readSupportBody(request);
  if ('error' in input) return input.error;
  const parsed = submission.safeParse(input.body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues.some(issue => issue.path[0] === 'email')
      ? 'Укажите действующий email.' : 'Проверьте описание заявки.' }, 400);
  }
  const description = cleanText(parsed.data.description, supportDescriptionLimit);
  if (!description) return json({ error: 'Опишите, с чем нужна помощь.' }, 400);
  try {
    const result = await createSupportTicket(parsed.data.id, parsed.data.email.toLowerCase(), description);
    if (result.state === 'limited') return json({ error: 'Слишком много заявок. Попробуйте позже.' }, 429);
    if (result.state === 'conflict') return json({ error: 'Обновите форму и отправьте заявку снова.' }, 409);
    await deliverSupportTicket(result.ticket).catch(() => console.error('Support delivery is temporarily unavailable'));
    return json({ id: result.ticket.id, number: result.ticket.number }, result.created ? 201 : 200);
  } catch {
    console.error('Support ticket storage failed');
    return json({ error: 'Не удалось сохранить заявку. Попробуйте ещё раз.' }, 503);
  }
}
