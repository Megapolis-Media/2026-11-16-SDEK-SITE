import { json, publicEdition, readStudio } from '../../server/studio';

export const dynamic = 'force-dynamic';

export async function GET() {
  return json(publicEdition(await readStudio()));
}
