import type { TrackItem } from '../chat-types';

export type Day = { day: string; messages: number; replies: number; images: number; tracks: number };
export type Totals = { messages: number; authors: number; replies: number; images: number; tracks: number; pending: number };
export type Report = { totals: Totals; days: Day[]; tracks: TrackItem[] };
export const trackFields = `id, title, artist, author_name AS authorName, phase,
  created_at AS createdAt, accepted_at AS acceptedAt`;

const dayKey = "strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', '+3 hours')";
const statsGroupsSQL = `WITH activity AS (
  SELECT ${dayKey} day, 1 messages, parent_id IS NOT NULL replies, image_key IS NOT NULL images, 0 tracks FROM chat_message
  UNION ALL
  SELECT ${dayKey} day, 0 messages, 0 replies, 0 images, 1 tracks FROM track_request
) SELECT day, SUM(messages) messages, SUM(replies) replies, SUM(images) images, SUM(tracks) tracks
  FROM activity GROUP BY day`;
const statsSQL = statsGroupsSQL + ' ORDER BY day DESC';

export async function report(db: D1Database): Promise<Report> {
  const data = await db.batch<Totals | Day | TrackItem>([
    db.prepare(`SELECT COUNT(*) messages, COUNT(DISTINCT COALESCE(author_key, 'old:' || client_key)) authors,
      COUNT(parent_id) replies, COUNT(image_key) images, (SELECT COUNT(*) FROM track_request) tracks,
      (SELECT COUNT(*) FROM track_request WHERE accepted_at IS NULL) pending FROM chat_message`),
    db.prepare(statsSQL + ' LIMIT 30'),
    db.prepare(`SELECT ${trackFields} FROM track_request ORDER BY (accepted_at IS NOT NULL), created_at DESC, id DESC LIMIT 40`),
  ]);
  const byDay = new Map((data[1].results as Day[]).map(day => [day.day, day]));
  const now = Date.now() + 10_800_000;
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(now - index * 86_400_000).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, messages: 0, replies: 0, images: 0, tracks: 0 };
  });
  return { totals: data[0].results[0] as Totals, days, tracks: data[2].results as TrackItem[] };
}

const authorsSQL = `WITH authors AS (
  SELECT COALESCE(author_key, 'old:' || client_key) author,
    author_name name, editorial, parent_id, image_key, created_at, id,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(author_key, 'old:' || client_key) ORDER BY created_at DESC, id DESC) seq
  FROM chat_message
) SELECT author AS authorKey,
  CASE WHEN author LIKE 'old:%' THEN 'Гость (архив)' ELSE COALESCE(MAX(CASE WHEN seq = 1 THEN name END), 'Гость') END name,
  SUBSTR(author, 1, 26) visitor, CASE WHEN MAX(editorial) = 1 THEN 'Редакция' ELSE 'Участник' END role,
  MIN(created_at) firstAt, MAX(created_at) lastAt, COUNT(*) messages, COUNT(parent_id) replies, COUNT(image_key) images
  FROM authors GROUP BY author`;
type AuthorRow = { authorKey: string; name: string; visitor: string; role: string; firstAt: number; lastAt: number; messages: number; replies: number; images: number };
const phaseNames: Record<string, string> = { before: 'До эфира', live: 'В эфире', after: 'После эфира' };
const moscow = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'short' });
type CSVRow = (string | number)[];

function csvLine(row: CSVRow) {
  return row.map(value => {
    let text = String(value);
    if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }).join(';') + '\r\n';
}

function csv<T>(filename: string, heading: CSVRow,
  query: (cursor: T | undefined, size: number) => D1PreparedStatement, fields: (row: T) => CSVRow) {
  const encoder = new TextEncoder();
  let cursor: T | undefined;
  const size = 200;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode('\uFEFF' + csvLine(heading))); },
    async pull(controller) {
      const rows = await query(cursor, size).all<T>();
      controller.enqueue(encoder.encode(rows.results.map(row => csvLine(fields(row))).join('')));
      if (rows.results.length < size) controller.close();
      cursor = rows.results.at(-1);
    },
  });
  return new Response(stream, { headers: {
    'content-type': 'text/csv; charset=utf-8', 'cache-control': 'no-store',
    'content-disposition': 'attachment; filename="' + filename + '"', 'x-content-type-options': 'nosniff',
  } });
}

export function download(db: D1Database, kind: string) {
  if (kind === 'participants') return csv<AuthorRow>('cdek-fm-participants.csv',
    ['Имя', 'ID участника', 'Роль', 'Первое сообщение (Мск)', 'Последнее сообщение (Мск)', 'Сообщений', 'Ответов', 'Картинок'],
    (cursor, size) => db.prepare(authorsSQL + (cursor ? ' HAVING author > ?' : '') + ' ORDER BY author LIMIT ?')
      .bind(...(cursor ? [cursor.authorKey] : []), size),
    row => [row.name, row.visitor, row.role, moscow.format(row.firstAt), moscow.format(row.lastAt), row.messages, row.replies, row.images]);
  if (kind === 'activity') return csv<Day>('cdek-fm-activity.csv', ['Дата (Мск)', 'Сообщений', 'Ответов', 'Картинок', 'Заявок на песни'],
    (cursor, size) => db.prepare(statsGroupsSQL + (cursor ? ' HAVING day < ?' : '') + ' ORDER BY day DESC LIMIT ?')
      .bind(...(cursor ? [cursor.day] : []), size),
    row => [row.day, row.messages, row.replies, row.images, row.tracks]);
  if (kind === 'tracks') return csv<TrackItem>('cdek-fm-tracks.csv', ['Название', 'Исполнитель', 'Имя', 'Режим', 'Заявка (Мск)', 'Принято (Мск)'],
    (cursor, size) => db.prepare(`SELECT ${trackFields} FROM track_request
      ${cursor ? 'WHERE created_at < ? OR (created_at = ? AND id < ?)' : ''}
      ORDER BY created_at DESC, id DESC LIMIT ?`)
      .bind(...(cursor ? [cursor.createdAt, cursor.createdAt, cursor.id] : []), size),
    row => [row.title, row.artist, row.authorName, phaseNames[row.phase] ?? row.phase, moscow.format(row.createdAt),
      row.acceptedAt ? moscow.format(row.acceptedAt) : '']);
  return null;
}
