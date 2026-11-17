import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { editorName, maxImageEdge, type GreetingMessage } from '../chat-types';
import { editorFor } from './studio';
import { hasStudioSession } from './studio-session';

function database() {
  if (!env.DB) throw new Error('Chat database is unavailable');
  return env.DB;
}

export const messageFields = `m.id, m.body, m.created_at AS createdAt, m.author_name AS authorName,
  m.editorial, m.parent_id AS parentId, m.thread_id AS threadId, m.image_key AS imageKey,
  m.image_width AS imageWidth, m.image_height AS imageHeight,
  COALESCE(p.author_name, CASE WHEN p.id IS NOT NULL THEN 'Гость' END) AS parentName,
  p.editorial AS parentEditorial`;
export const messageTables = 'chat_message m LEFT JOIN chat_message p ON p.id = m.parent_id';
export const countReplies = '(SELECT COUNT(*) FROM chat_message r WHERE r.thread_id = m.id)';
type MessageRow = Omit<GreetingMessage, 'imageUrl' | 'editorial'> & {
  imageKey: string | null;
  editorial: number;
  parentEditorial: number | null;
};

export function presentMessage(row: MessageRow): GreetingMessage {
  const { imageKey, editorial, parentEditorial, ...item } = row;
  return {
    ...item,
    authorName: editorial ? editorName : item.authorName || 'Гость',
    parentName: parentEditorial ? editorName : item.parentName,
    editorial: Boolean(editorial),
    imageUrl: imageKey ? '/api/chat/image/' + item.id : null,
  };
}

export async function messageById(id: string) {
  return database().prepare(`SELECT ${messageFields}, ${countReplies} AS replyCount FROM ${messageTables} WHERE m.id = ?`)
    .bind(id).first<MessageRow>();
}

export async function chatModerationRevision() {
  return await database().prepare('SELECT revision FROM chat_moderation WHERE id = 1').first<number>('revision') ?? 0;
}

export async function hash(value: string | ArrayBuffer) {
  const buffer = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function cleanText(value: unknown, maximum: number) {
  if (typeof value !== 'string') return null;
  const text = value.trim().normalize('NFC');
  if (text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) return null;
  return text;
}

export async function visitor(request: Request, client: string, name: string) {
  const user = await getChatGPTUser();
  const editorial = editorFor(user) || await hasStudioSession();
  const id = await hash('cdek-fm:author:' + (user ? 'account:' + user.userId : 'guest:' + client));
  const fingerprint = await hash('cdek-fm-chat:' + (request.headers.get('cf-connecting-ip') || client));
  const reserved = /редакци[яи]\s*(сд[эе]к|cdek)|^(сд[эе]к|cdek)\s*fm$/i;
  const nickname = name.replace(/\s+/g, ' ');
  return { id, fingerprint, editorial, name: editorial ? editorName : (nickname && !reserved.test(nickname) ? nickname : 'Гость ' + id.slice(0, 5).toUpperCase()) };
}

export async function readBytes(request: Request, limit: number) {
  if (Number(request.headers.get('content-length')) > limit) throw new RangeError();
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) { await reader.cancel(); throw new RangeError(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function inspectImage(buffer: ArrayBuffer) {
  const data = new DataView(buffer);
  const tag = (at: number, text: string) => at + text.length <= data.byteLength
    && [...text].every((character, index) => data.getUint8(at + index) === character.charCodeAt(0));
  const image = (type: string, width: number, height: number) =>
    width > 0 && height > 0 && width <= maxImageEdge && height <= maxImageEdge ? { type, width, height } : null;
  if (data.byteLength < 24) return null;
  if (data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a && tag(12, 'IHDR')) {
    return image('image/png', data.getUint32(16), data.getUint32(20));
  }
  if (tag(0, 'RIFF') && tag(8, 'WEBP') && data.getUint32(4, true) + 8 === data.byteLength && data.byteLength >= 30) {
    if (tag(12, 'VP8X')) {
      if (data.getUint8(20) & 2) return null;
      const size = (at: number) => 1 + data.getUint16(at, true) + data.getUint8(at + 2) * 65536;
      return image('image/webp', size(24), size(27));
    }
    if (tag(12, 'VP8L') && data.getUint8(20) === 0x2f) {
      const dimensions = data.getUint32(21, true);
      return image('image/webp', 1 + (dimensions & 0x3fff), 1 + ((dimensions >>> 14) & 0x3fff));
    }
    if (tag(12, 'VP8 ') && data.getUint8(23) === 0x9d && data.getUint16(24) === 0x012a)
      return image('image/webp', data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
  }
  if (data.getUint16(0) === 0xffd8) {
    let at = 2;
    while (at + 8 < data.byteLength && data.getUint8(at) === 0xff) {
      const marker = data.getUint8(at + 1);
      const length = data.getUint16(at + 2);
      if (length < 2 || at + length + 2 > data.byteLength) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3].includes(marker) && length >= 8)
        return image('image/jpeg', data.getUint16(at + 7), data.getUint16(at + 5));
      at += length + 2;
    }
  }
  return null;
}

export async function listMessages(filter: string, args: (string | number)[], size: number, count: boolean) {
  const rows = await database().prepare(`SELECT ${messageFields}, ${count ? countReplies : '0'} AS replyCount
    FROM ${messageTables} WHERE ${filter} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .bind(...args, size + 1).all<MessageRow>();
  const page = rows.results.slice(0, size);
  return { older: rows.results.length > size ? page.at(-1)?.id ?? null : null, messages: page.reverse().map(presentMessage) };
}
