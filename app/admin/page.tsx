import type { Metadata } from 'next';
import Link from 'next/link';
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser } from '../chatgpt-auth';
import { editorFor, readStudio } from '../server/studio';
import { hasStudioSession } from '../server/studio-session';
import { StudioAdmin } from './studio-admin';
import './studio.css';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Редакция · СДЭК FM', robots: { index: false, follow: false } };

const errors: Record<string, string> = {
  credentials: 'Неверный логин или пароль.',
  limited: 'Слишком много попыток. Попробуйте снова через несколько минут.',
  unavailable: 'Вход временно недоступен. Попробуйте позже.',
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const user = await getChatGPTUser();
  if (editorFor(user) || await hasStudioSession()) return <StudioAdmin initial={await readStudio()} />;
  const { error } = await searchParams;
  const message = typeof error === 'string' && Object.hasOwn(errors, error) ? errors[error] : '';
  return <main className="studio-login">
    <section className="studio-login-card" aria-labelledby="studio-login-title">
      <img src="/visual/cdek-fm.svg" width="136" height="24" alt="СДЭК FM" />
      <h1 id="studio-login-title">Вход для редакции</h1>
      {message && <p className="studio-login-error" role="alert">{message}</p>}
      <form className="studio-login-form" method="post" action="/api/admin/session">
        <input type="hidden" name="action" value="login" />
        <label>Логин
          <input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64} />
        </label>
        <label>Пароль
          <input type="password" name="password" autoComplete="current-password" required maxLength={128} />
        </label>
        <button className="studio-login-button" type="submit">Войти</button>
      </form>
      <div className="studio-login-links">
        <Link href="/">На сайт</Link>
        {process.env.CDEK_RUNTIME !== 'node' && <a href={user ? chatGPTSignOutPath('/admin') : chatGPTSignInPath('/admin')} target="_top">
          {user ? 'Сменить аккаунт ChatGPT' : 'Войти через ChatGPT'}
        </a>}
      </div>
    </section>
  </main>;
}
