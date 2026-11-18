import { handleBridge } from '../../server/support-bridge';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handler(request: Request, context: Context) {
  return handleBridge(request, (await context.params).path);
}
export const GET = handler;
export const POST = handler;
