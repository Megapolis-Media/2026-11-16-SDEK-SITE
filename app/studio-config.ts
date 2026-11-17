import { z } from 'zod';

export const phases = ['before', 'live', 'after'] as const;
export type Phase = typeof phases[number];
export const phaseLabels: Record<Phase, string> = { before: 'До эфира', live: 'В эфире', after: 'После эфира' };
export const blocks = ['broadcast', 'activities', 'television', 'chat', 'archive', 'circuit-chat'] as const;
// Keep the legacy chat settings readable while exposing one combined section.
export const displayBlocks = blocks.filter(id => id !== 'chat');
export const blockLabels = {
  broadcast: 'Первый экран', activities: 'Возможности эфира', television: 'Телетрансляция',
  chat: 'Приветы и чат', archive: 'Архив эфиров', 'circuit-chat': 'Приветы и чат',
};
export type Block = typeof blocks[number];
export const visualLabels = { full: 'Объёмная сцена', soft: 'Приглушённая графика', clean: 'Чистый фон' };
const presentation = z.object({ visible: z.boolean(), visual: z.enum(['full', 'soft', 'clean']) });
const text = (max: number) => z.string().trim().min(1).max(max);
export function serviceUrl(value: unknown) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
const optionalUrl = z.string().trim().max(1800).refine(value => !value || !!serviceUrl(value), 'Укажите адрес с https://');
const requiredUrl = optionalUrl.refine(Boolean, 'Укажите ссылку');

export function dialHref(number: string) {
  if (!/^[+\d\s().-]+$/.test(number)) return '';
  const compact = number.replace(/[^+\d]/g, '');
  if (!/^\+?\d{7,15}$/.test(compact)) return '';
  return 'tel:' + (/^8\d{10}$/.test(compact) ? '+7' + compact.slice(1) : compact);
}

function messengerUrl(hosts: string[], message: string) {
  return optionalUrl.refine(value => {
    if (!value) return true;
    const href = serviceUrl(value);
    if (!href) return false;
    const { hostname, pathname } = new URL(href);
    return hosts.includes(hostname) && pathname !== '/';
  }, message);
}

const contactNumber = z.string().trim().max(32).refine(value => !value || !!dialHref(value), 'Укажите номер телефона');
const telegramLink = messengerUrl(['t.me', 'telegram.me'], 'Укажите ссылку на чат Telegram (t.me)');
const maxLink = messengerUrl(['max.ru', 'www.max.ru', 'web.max.ru'], 'Укажите ссылку-приглашение MAX (max.ru)');
const contactsSchema = z.object({
  phoneEnabled: z.boolean(),
  phoneNumber: contactNumber,
  messengerNumber: contactNumber,
  telegramEnabled: z.boolean(),
  telegramUrl: telegramLink,
  maxEnabled: z.boolean(),
  maxUrl: maxLink,
}).refine(contacts => !contacts.phoneEnabled || !!contacts.phoneNumber, 'Укажите номер для звонков')
  .refine(contacts => !!contacts.messengerNumber ||
    ((!contacts.telegramEnabled || !!contacts.telegramUrl) && (!contacts.maxEnabled || !!contacts.maxUrl)),
  'Укажите номер для мессенджеров или добавьте прямые ссылки');
export type Contacts = z.infer<typeof contactsSchema>;

export function defaultContacts(settings: Record<string, unknown> = {}): Contacts {
  const max = maxLink.safeParse(serviceUrl(settings.CDEK_MAX_URL));
  return {
    phoneEnabled: true, phoneNumber: '8 800 300 63 08', messengerNumber: '+7 969 100 99 39',
    telegramEnabled: true, telegramUrl: '', maxEnabled: true, maxUrl: max.success ? max.data : '',
  };
}

const archiveItem = z.object({ title: text(100), date: text(160), url: optionalUrl, embedded: z.boolean() });
const blockConfig = Object.fromEntries(blocks.map(id => [id, presentation])) as Record<Block, typeof presentation>;
const editionSchema = z.object({
  radioEnabled: z.boolean(), radioUrl: requiredUrl,
  tvEnabled: z.boolean(), tvUrl: requiredUrl.refine(value => {
    try {
      const url = new URL(value);
      return url.hostname === 'facecast.net' || url.hostname.endsWith('.facecast.net');
    } catch { return false; }
  }, 'Нужна ссылка на Facecast'),
  tracksEnabled: z.boolean(), blocks: z.object(blockConfig),
  hero: z.object({ title: text(54), accent: text(54), description: text(190), date: text(100) }),
  activities: z.object({ watch: text(100), when: text(100), call: text(100), greetings: text(100) }),
  television: z.object({ title: text(75), accent: text(65) }),
  greetings: z.object({ title: text(90), accent: text(90), ending: text(90), subtitle: text(120) }),
  archive: z.object({ title: text(90), december: archiveItem, february: archiveItem }),
  circuitTitle: text(100),
});
export type Edition = z.infer<typeof editionSchema>;
export function blockPresentation(edition: Edition, id: Block) {
  if (id !== 'circuit-chat') return edition.blocks[id];
  return {
    ...edition.blocks['circuit-chat'],
    visible: edition.blocks.chat.visible || edition.blocks['circuit-chat'].visible,
  };
}
export const studioSchema = z.object({
  active: z.enum(phases),
  metrika: z.string().trim().regex(/^(?:[1-9][0-9]{0,11})?$/, 'Укажите номер счётчика цифрами'),
  contacts: contactsSchema.default(() => defaultContacts()),
  editions: z.object({ before: editionSchema, live: editionSchema, after: editionSchema }),
});
export type Studio = z.infer<typeof studioSchema>;
export type StudioDocument = { studio: Studio; revision: number; updatedAt: number | null };
export type PublicEdition = { phase: Phase; edition: Edition; metrika: string; contacts: Contacts; revision: number };

export function defaultStudio(settings: Record<string, unknown> = {}): Studio {
  const february = serviceUrl(settings.CDEK_ARCHIVE_FEBRUARY_URL);
  const edition: Edition = {
    radioEnabled: true, radioUrl: serviceUrl(settings.CDEK_RADIO_URL) || 'https://m14m128.hostingradio.ru:8074/m14m128.mp3',
    tvEnabled: true, tvUrl: serviceUrl(settings.CDEK_VIDEO_URL) || 'https://facecast.net/w/7xgkhi?autorun=auto',
    tracksEnabled: false,
    blocks: Object.fromEntries(blocks.map(id => [id, { visible: true, visual: 'full' }])) as Edition['blocks'],
    hero: { title: 'На высоких', accent: 'скоростях!', description: 'Специальный телерадиоэфир\nдля команды СДЭК!', date: '24 ноября с 09:00 до 12:00 по Мск' },
    activities: { watch: 'Слушай и смотри трансляцию', when: 'с 09:00 до 12:00 по Мск', call: 'Звони в прямой эфир и участвуй в играх', greetings: 'Передавай приветы коллегам!' },
    television: { title: 'Подключайся', accent: 'к трансляции!' },
    greetings: { title: 'Экспресс-доставка', accent: 'тёплых слов', ending: 'и пожеланий!', subtitle: 'Передавай приветы коллегам!' },
    archive: {
      title: 'Архив эфиров',
      december: { title: 'Новогодний бум на CDEK FM!', date: 'Эфир от 25 декабря 2025 года', url: serviceUrl(settings.CDEK_ARCHIVE_DECEMBER_URL) || 'https://kinescope.io/embed/awMBnYL4KwDNWN1xK5JFeh', embedded: true },
      february: { title: 'Между нами СДЭК!', date: 'Эфир ко дню рождения компании от 25 февраля 2026 года', url: february || 'https://kinescope.io/oJE8Aer2vqsVnkWPGpfkjB', embedded: Boolean(february) },
    },
    circuitTitle: 'Передавай приветы коллегам!',
  };
  const after = structuredClone(edition);
  after.radioEnabled = after.tvEnabled = after.tracksEnabled = false;
  after.blocks.television.visible = false;
  return { active: 'before', metrika: '105895560', contacts: defaultContacts(settings),
    editions: { before: edition, live: structuredClone(edition), after } };
}
