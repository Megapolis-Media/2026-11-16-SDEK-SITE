import { Site } from './cinematic/site';
import { isEditor, publicEdition, readStudio } from './server/studio';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const [document, editorial] = await Promise.all([readStudio(), isEditor()]);
  return <Site initial={publicEdition(document)} editorial={editorial} />;
}
