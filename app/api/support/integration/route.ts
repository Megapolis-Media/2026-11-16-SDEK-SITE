import { env } from 'cloudflare:workers';
import { supportId, supportStatusChange } from '../../../support-types';
import { json } from '../../../server/studio';
import { supportIntegrationAuth } from '../../../server/support-delivery';
import { changeSupportStatus, parseSupportCursor, readSupportBody, supportTicketById, takeSupportTickets } from '../../../server/support';

export const dynamic = 'force-dynamic';

function checkAccess(request: Request) {
  const access = supportIntegrationAuth(request);
  if (access === 'denied') {
    const response = json({ error: 'Invalid integration token.' }, 401);
    response.headers.set('www-authenticate', 'Bearer');
    return response;
  }
  if (access === 'unavailable' || !env.DB) return json({ error: 'Integration unavailable.' }, 503);
}

export async function GET(request: Request) {
  const error = checkAccess(request);
  if (error) return error;
  const params = new URL(request.url).searchParams;
  const id = params.get('id');
  const after = parseSupportCursor(params.get('after'), 0);
  const limit = parseSupportCursor(params.get('limit'), 50);
  if ((id !== null && !supportId.safeParse(id).success) || after === null || limit === null || limit < 1 || limit > 100) {
    return json({ error: 'Invalid ticket ID, cursor or page size.' }, 400);
  }
  try {
    if (id) {
      const ticket = await supportTicketById(id);
      return ticket ? json({ ticket }) : json({ error: 'Ticket not found.' }, 404);
    }
    return json(await takeSupportTickets(after, limit));
  } catch {
    return json({ error: 'Ticket storage unavailable.' }, 503);
  }
}

export async function PATCH(request: Request) {
  const error = checkAccess(request);
  if (error) return error;
  const input = await readSupportBody(request);
  if ('error' in input) return input.error;
  const parsed = supportStatusChange.safeParse(input.body);
  if (!parsed.success) return json({ error: 'Expected id, status and updatedAt.' }, 400);
  try {
    return await changeSupportStatus(parsed.data);
  } catch {
    return json({ error: 'Ticket storage unavailable.' }, 503);
  }
}
