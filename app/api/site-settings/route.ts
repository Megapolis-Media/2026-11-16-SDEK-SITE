import { json, publicEdition, readStudio } from '../../server/studio';
import { withApiErrors } from '../../server/api-errors';

export const dynamic = 'force-dynamic';

async function readSettings() {
  return json(publicEdition(await readStudio()));
}

export const GET = withApiErrors(readSettings, 'Настройки сайта временно недоступны.');
