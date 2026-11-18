import { uuid } from '../../../chat-types';
import { visitor } from '../../../server/chat';
import { photoAllowance } from '../../../server/photo-limits';
import { json } from '../../../server/studio';
import { withApiErrors } from '../../../server/api-errors';

export const dynamic = 'force-dynamic';

async function readLimit(request: Request) {
  const client = new URL(request.url).searchParams.get('client');
  if (!client || !uuid.test(client)) return json({}, 400);
  const author = await visitor(request, client, '');
  return json(await photoAllowance(author.id));
}

export const GET = withApiErrors(readLimit, 'Не удалось проверить лимит фотографий. Попробуйте ещё раз.');
