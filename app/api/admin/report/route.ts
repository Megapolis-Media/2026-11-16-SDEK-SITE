import { env } from 'cloudflare:workers';
import { isEditor, json } from '../../../server/studio';
import { download, report } from '../../../server/reports';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!(await isEditor())) return json({}, 403);
  const db = env.DB;
  if (!db) return json({}, 503);
  const kind = new URL(request.url).searchParams.get('download');
  return kind ? download(db, kind) ?? json({}, 404) : json(await report(db));
}
