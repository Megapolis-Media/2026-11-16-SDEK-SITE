import { env } from 'cloudflare:workers';
import { isEditor, json } from '../../../server/studio';
import { download, report } from '../../../server/reports';
import { withApiErrors } from '../../../server/api-errors';

export const dynamic = 'force-dynamic';

async function readReport(request: Request) {
  if (!(await isEditor())) return json({}, 403);
  const db = env.DB;
  if (!db) return json({}, 503);
  const kind = new URL(request.url).searchParams.get('download');
  return kind ? download(db, kind) ?? json({}, 404) : json(await report(db));
}

export const GET = withApiErrors(readReport, 'Не удалось загрузить отчёт. Попробуйте ещё раз.');
