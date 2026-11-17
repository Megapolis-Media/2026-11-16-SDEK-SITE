import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { defaultContacts, defaultStudio, studioSchema, type PublicEdition, type StudioDocument } from '../studio-config';
import { hasStudioSession } from './studio-session';

export const noCache = { 'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' };

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: noCache });
}

export function sameOrigin(request: Request) {
  const mode = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  return (!mode || mode === 'same-origin' || mode === 'none') && (!origin || origin === new URL(request.url).origin);
}

export function editorFor(user: Awaited<ReturnType<typeof getChatGPTUser>>) {
  const email = user?.email.trim().toLowerCase();
  return !!email && (env.CDEK_EDITOR_EMAILS ?? '').split(',').some(entry => entry.trim().toLowerCase() === email);
}

export async function isEditor() {
  return editorFor(await getChatGPTUser()) || await hasStudioSession();
}

export async function readStudio(): Promise<StudioDocument> {
  const row = await env.DB?.prepare('SELECT content, revision, updated_at AS updatedAt FROM site_studio WHERE id = 1')
    .first<{ content: string; revision: number; updatedAt: number }>();
  if (!row) return { studio: defaultStudio(env as Record<string, unknown>), revision: 0, updatedAt: null };
  const parsed = studioSchema.parse({ contacts: defaultContacts(env as Record<string, unknown>), ...JSON.parse(row.content) });
  return { studio: parsed, revision: row.revision, updatedAt: row.updatedAt };
}

export function publicEdition({ studio, revision }: StudioDocument): PublicEdition {
  return { phase: studio.active, edition: studio.editions[studio.active], metrika: studio.metrika, contacts: studio.contacts, revision };
}
