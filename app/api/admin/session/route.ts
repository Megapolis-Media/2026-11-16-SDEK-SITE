import { chatGPTSignOutPath, getChatGPTUser } from '../../../chatgpt-auth';
import { readBytes } from '../../../server/chat';
import { editorFor, json, noCache, sameOrigin } from '../../../server/studio';
import { endStudioSession, startStudioSession } from '../../../server/studio-session';

export const dynamic = 'force-dynamic';

function redirectTo(path: string, cookie?: string) {
  const headers = new Headers({ ...noCache, location: path });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({}, 403);
  if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) return json({}, 415);

  let form: URLSearchParams;
  try { form = new URLSearchParams(new TextDecoder().decode(await readBytes(request, 4096))); }
  catch { return redirectTo('/admin?error=credentials'); }

  const action = form.get('action');
  try {
    if (action === 'logout') {
      const cookie = await endStudioSession();
      const path = editorFor(await getChatGPTUser()) ? chatGPTSignOutPath('/admin') : '/admin';
      return redirectTo(path, cookie);
    }

    const username = form.get('username') ?? '';
    const password = form.get('password') ?? '';
    if (action !== 'login' || !username || username.length > 64 || !password || password.length > 128)
      return redirectTo('/admin?error=credentials');

    const session = await startStudioSession(request, username, password);
    return session.cookie ? redirectTo('/admin', session.cookie) : redirectTo('/admin?error=' + session.error);
  } catch {
    console.error('Studio session operation failed');
    if (action === 'logout') return json({ error: 'Не удалось выйти. Попробуйте ещё раз.' }, 503);
    return redirectTo('/admin?error=unavailable');
  }
}
