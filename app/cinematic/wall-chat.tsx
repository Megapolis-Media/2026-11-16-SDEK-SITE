'use client';

import {
  type ChangeEvent, type FormEvent, type MouseEvent, type ReactNode, type RefObject,
  useCallback, useEffect, useId, useRef, useState, useSyncExternalStore,
} from 'react';
import NextImage from 'next/image';
import {
  chatClient, dailyPhotoLimit, editorName, getNickname, maxImageBytes, maxImageEdge, messageLimit, saveNickname,
  type ChatThread, type GreetingMessage, type PhotoAllowance,
} from '../chat-types';
import { type GreetingCard, useGreetings } from './greetings';
import { Icon } from './icons';
import { metric } from './metrika';
import { useOptionalOnAir } from './on-air';

const moscow = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
const moscowFull = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const subscribeNickname = () => () => {};
const serverNickname = () => '';

function AttachmentIcon({ size = 19 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="9" r="1.45" /><path d="m3 16 4-4 4 4 4-5 6 5" />
  </svg>;
}

async function preparePicture(file: File) {
  if (file.size > 24 * 1024 * 1024) throw new Error('Выберите картинку размером до 24 МБ');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error();
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, maxImageEdge / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error();
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const encode = (type: string, quality: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
    let blob = await encode('image/webp', .86);
    if (!blob || blob.size > maxImageBytes) blob = await encode('image/jpeg', .75);
    if (!blob || blob.size > maxImageBytes) throw new Error();
    return new File([blob], blob.type === 'image/webp' ? 'image.webp' : blob.type === 'image/png' ? 'image.png' : 'image.jpg', { type: blob.type });
  } finally { URL.revokeObjectURL(url); }
}

function captureComposer(panel: HTMLElement, form: HTMLFormElement): GreetingCard | undefined {
  const field = form.querySelector('textarea');
  const submit = form.querySelector('button[type=submit]');
  if (!field || !submit) return;
  const rect = panel.getBoundingClientRect();
  if (!rect.width || rect.bottom < 0 || rect.top > innerHeight || rect.height > 1300) return;
  const relative = (element: Element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left - rect.left, y: bounds.top - rect.top, width: bounds.width, height: bounds.height };
  };
  const formTop = panel === form ? 1 : relative(form).y;
  const lines = Array.from(panel.querySelectorAll('.wall-message')).map(element => ({
    ...relative(element), text: element.querySelector('.wall-message-body')?.textContent ?? '',
    time: element.querySelector('time')?.textContent ?? '',
  })).filter(line => line.y + line.height > 5 && line.y < formTop && line.height > 20);
  const preview = form.querySelector<HTMLImageElement>('.wall-attached img');
  let photo: GreetingCard['photo'];
  if (preview?.complete && preview.naturalWidth) {
    const canvas = document.createElement('canvas');
    const ratio = Math.min(1, 380 / Math.max(preview.naturalWidth, preview.naturalHeight));
    canvas.width = Math.max(1, Math.round(preview.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(preview.naturalHeight * ratio));
    canvas.getContext('2d')?.drawImage(preview, 0, 0, canvas.width, canvas.height);
    photo = { canvas, ...relative(preview) };
  }
  return { rect, width: rect.width, height: rect.height, formTop, input: relative(field), send: relative(submit), lines, photo };
}

function Composer({ editorial = false, admin = false, circuit = false, panel, target, cancel, sent }: {
  editorial?: boolean; admin?: boolean; circuit?: boolean; panel?: RefObject<HTMLDivElement | null>;
  target?: GreetingMessage; cancel?: () => void; sent?: () => void;
}) {
  const { beginSend, finishSend } = useGreetings();
  const air = useOptionalOnAir();
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const attempt = useRef('');
  const mounted = useRef(true);
  const photoUrl = useRef('');
  const storedName = useSyncExternalStore(subscribeNickname, getNickname, serverNickname);
  const [editedName, setName] = useState<string>();
  const name = editedName ?? storedName;
  const [body, setBody] = useState('');
  const [picture, setPicture] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [packing, setPacking] = useState(false);
  const [notice, setNotice] = useState('');
  const [photos, setPhotos] = useState<PhotoAllowance | null>(null);
  const nameId = useId();
  const messageId = useId();
  const replyId = useId();
  const replyTarget = target?.id;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (photoUrl.current) URL.revokeObjectURL(photoUrl.current); };
  }, []);
  useEffect(() => {
    if (replyTarget) input.current?.focus();
  }, [replyTarget]);
  useEffect(() => {
    if (!packing) return;
    const timer = window.setTimeout(() => setPacking(false), 870);
    return () => window.clearTimeout(timer);
  }, [packing]);

  function resetPhoto(file: File | null) {
    if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    photoUrl.current = file ? URL.createObjectURL(file) : '';
    setPreview(photoUrl.current);
    setPicture(file);
  }

  async function attach(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setNotice('');
    setPreparing(true);
    try {
      const limitResponse = await fetch('/api/chat/photo-limit?client=' + chatClient(), { cache: 'no-store' });
      if (!limitResponse.ok) throw new Error('Не удалось проверить лимит фотографий. Попробуйте ещё раз.');
      const allowance: PhotoAllowance = await limitResponse.json();
      if (!mounted.current) return;
      setPhotos(allowance);
      if (!allowance.remaining) {
        setNotice('Сегодня вы уже отправили 3 фотографии. Новые фото доступны после 00:00 по Москве. Текстовые сообщения можно отправлять.');
        return;
      }
      const prepared = await preparePicture(file);
      if (!mounted.current) return;
      attempt.current = '';
      resetPhoto(prepared);
    } catch (error) {
      setNotice(error instanceof Error && error.message.startsWith('Не удалось проверить') ? error.message :
        file.size > 24 * 1024 * 1024 ? 'Выберите картинку размером до 24 МБ' : 'Не удалось открыть картинку. Попробуйте JPG, PNG или WebP');
    } finally { if (mounted.current) setPreparing(false); }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (packing || busy || preparing || (!body.trim() && !picture) || !beginSend()) return;
    const form = event.currentTarget;
    const wasFocused = form.contains(document.activeElement);
    setBusy(true);
    setNotice('');
    attempt.current ||= crypto.randomUUID();
    const fields = new FormData();
    fields.set('id', attempt.current);
    fields.set('client', chatClient());
    fields.set('authorName', name.trim());
    fields.set('body', body.trim());
    if (target) fields.set('parentId', target.id);
    if (picture) fields.set('image', picture);
    try {
      const response = await fetch('/api/chat', { method: 'POST', body: fields });
      const result = await response.json() as { error?: string; photoAllowance?: PhotoAllowance };
      if (result.photoAllowance) setPhotos(result.photoAllowance);
      if (!response.ok) throw new Error(result.error ?? 'Связь прервалась. Попробуйте ещё раз');
      const message = result as unknown as GreetingMessage;
      const animate = !admin && air?.motionReady && !air.motionPaused && !document.hidden;
      const card = animate ? captureComposer(panel?.current ?? form, form) : undefined;
      if (card && !panel && !target) setPacking(true);
      if (!editorial) saveNickname(name.trim());
      finishSend(message, card, circuit, !!panel && !target);
      if (!admin && response.status === 201) metric('chat_message');
      setBody('');
      resetPhoto(null);
      attempt.current = '';
      setNotice(result.photoAllowance ? result.photoAllowance.remaining
        ? 'Фотография отправлена. Сегодня можно отправить ещё ' + result.photoAllowance.remaining + '.'
        : 'Фотография отправлена. Сегодняшний лимит из 3 фотографий использован. Новые фото доступны после 00:00 по Москве.'
        : target ? 'Ответ опубликован' : 'Сообщение опубликовано');
      if (panel?.current && wasFocused) document.querySelector<HTMLAnchorElement>('.air-greeting')?.focus({ preventScroll: true });
      sent?.();
    } catch (error) {
      finishSend();
      setNotice(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Связь прервалась. Попробуйте ещё раз');
    } finally { setBusy(false); }
  }

  const blocked = busy || preparing || packing;
  const simple = circuit && !admin;
  const attachment = <>
    <input className="wall-file" ref={fileInput} aria-label="Выбрать файл" tabIndex={-1} type="file"
      accept="image/jpeg,image/png,image/webp,image/gif,.heic,.heif" disabled={blocked} onChange={event => void attach(event)} />
    <button type="button" className="wall-add-image" aria-label="Прикрепить картинку" title="Прикрепить картинку"
      disabled={blocked} onClick={() => fileInput.current?.click()}><AttachmentIcon />{simple && <span>Добавить фото</span>}</button>
  </>;
  return <form className={'chat-form wall-compose' + (simple ? ' wall-compose-simple' : '')} onSubmit={send} aria-busy={busy || preparing} data-packing={packing} inert={packing}>
    {target && <div className="wall-reply-target" id={replyId}>
      <span>Ответ для <strong>{target.authorName}</strong></span>
      <button type="button" onClick={cancel} disabled={busy}>Отмена</button>
    </div>}
    {editorial
      ? <span className="wall-compose-as"><span className="wall-editor-mark" aria-hidden="true">✓</span>От имени {editorName}</span>
      : <label className="wall-name" htmlFor={nameId}>{simple ? 'Имя' : <>Ваше имя<span> (необязательно)</span></>}
        <input id={nameId} value={name} onChange={event => { setName(event.target.value); attempt.current = ''; }} maxLength={40}
          disabled={busy} autoComplete="nickname" placeholder="Гость" />
      </label>}
    {preview && <div className="wall-attached">
      {/* eslint-disable-next-line @next/next/no-img-element -- A browser blob preview has no intrinsic dimensions until it decodes. */}
      <img src={preview} alt="Прикреплённая картинка" />
      <button type="button" onClick={() => { resetPhoto(null); attempt.current = ''; }} disabled={blocked}>Убрать картинку</button>
    </div>}
    <div className="wall-compose-row">
      {!simple && attachment}
      {simple && <label className="wall-message-label" htmlFor={messageId}>{target ? 'Ответ' : 'Сообщение'}</label>}
      <textarea id={messageId} ref={input} rows={simple ? 3 : 2} maxLength={messageLimit} aria-label={simple ? undefined : target ? 'Текст ответа' : 'Текст сообщения'}
        aria-describedby={target ? replyId : undefined} placeholder={target ? 'Напишите ответ' : 'Напишите сообщение'}
        value={body} disabled={busy} onChange={event => { setBody(event.target.value); attempt.current = ''; }}
        onKeyDown={event => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }} />
      {simple && attachment}
      <button type="submit" className="wall-send" aria-label={target ? 'Отправить ответ' : 'Отправить сообщение'}
        disabled={blocked || (!body.trim() && !picture)}>
        {busy ? <span className="spinner" /> : <Icon name="send" size={19} />}
        {simple && <span>{busy ? 'Отправляем…' : 'Отправить'}</span>}
      </button>
    </div>
    <p className="wall-notice">До {dailyPhotoLimit} фотографий в день. Новый день — в 00:00 по Москве.
      {photos && photos.remaining > 0 && <> Сегодня доступно: {photos.remaining}.</>}</p>
    {(preparing || notice) && <p className="wall-notice" role="status">{preparing ? 'Проверяем и готовим картинку…' : notice}</p>}
  </form>;
}

function Message({ item, onReply, circuit, toggle, expanded }: {
  item: GreetingMessage; onReply: () => void; circuit?: boolean; toggle?: () => void; expanded?: boolean;
}) {
  const { choose, selected } = useGreetings();
  const air = useOptionalOnAir();
  const date = new Date(item.createdAt);
  return <article className="chat-message wall-message" data-message-id={item.id} data-editorial={item.editorial} data-selected={selected === item.id}>
    <header className="wall-message-meta">
      <div className="wall-avatar" aria-hidden="true">{item.editorial ? '✓' : item.authorName.slice(0, 1).toUpperCase()}</div>
      <strong>{item.authorName}</strong>
      <time dateTime={date.toISOString()} title={moscowFull.format(date)}>{moscow.format(date)}</time>
    </header>
    {item.parentName && <div className="wall-in-reply">В ответ {item.parentName}</div>}
    {item.body && <p className="wall-message-body">{item.body}</p>}
    {item.imageUrl && <a className="wall-message-image" href={item.imageUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть картинку в новой вкладке">
      <NextImage unoptimized src={item.imageUrl} alt="Картинка в сообщении" width={item.imageWidth ?? maxImageEdge} height={item.imageHeight ?? maxImageEdge} loading="lazy" />
    </a>}
    <div className="wall-actions">
      <button type="button" onClick={onReply}>Ответить</button>
      {toggle && item.replyCount > 0 && <button type="button" aria-expanded={expanded} onClick={toggle}>
        {expanded ? 'Свернуть ветку' : `Ответы · ${item.replyCount}`}
      </button>}
      {circuit && <button className="wall-3d" type="button" onClick={() => {
        choose(item.id);
        if (innerWidth <= 1000) {
          document.getElementById('circuit-chat')?.scrollIntoView({ block: 'start', behavior: air?.motionPaused ? 'instant' : 'smooth' });
        }
      }} aria-label="Показать посылку в 3D"><Icon name="parcel" size={15} /></button>}
    </div>
  </article>;
}

type ThreadProps = { editorial?: boolean; admin?: boolean; circuit?: boolean };
function Branch({ root, editorial, admin, circuit }: ThreadProps & { root: GreetingMessage }) {
  const { recent, moderation } = useGreetings();
  const [expanded, setExpanded] = useState(false);
  const [target, setTarget] = useState<GreetingMessage>();
  const [items, setItems] = useState<GreetingMessage[]>([]);
  const [loadedRevision, setLoadedRevision] = useState(moderation);
  const [older, setOlder] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const loadedEarlier = useRef(false);
  const loadedModeration = useRef(moderation);
  const sequence = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  const rootId = root.id;
  const saidHere = recent?.threadId === rootId ? recent : undefined;

  const load = useCallback((before?: string, signal?: AbortSignal) => {
    const run = ++sequence.current;
    return fetch('/api/chat?thread=' + rootId + (before ? '&before=' + before : ''), { cache: 'no-store', signal }).then(async response => {
      if (!response.ok) throw new Error();
      return await response.json() as ChatThread;
    }).then(result => {
      if (signal?.aborted || run !== sequence.current) return;
      if (before) loadedEarlier.current = true;
      setItems(previous => {
        if (!loadedEarlier.current) return result.replies;
        return [...new Map([...previous, ...result.replies].map(item => [item.id, item])).values()]
          .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      });
      if (before || !loadedEarlier.current) setOlder(result.older);
      setLoadedRevision(moderation);
      setError(false);
    }).catch(() => {
      if (!signal?.aborted && run === sequence.current) setError(true);
    }).finally(() => {
      if (!signal?.aborted && run === sequence.current) setLoading(false);
    });
  }, [rootId, moderation]);

  useEffect(() => {
    if (!expanded) return;
    if (moderation !== loadedModeration.current) {
      loadedModeration.current = moderation;
      loadedEarlier.current = false;
    }
    const pull = new AbortController();
    void load(undefined, pull.signal);
    return () => pull.abort();
  }, [expanded, load, root.replyCount, saidHere, moderation]);

  function replyTo(message: GreetingMessage) {
    setExpanded(true);
    setTarget(message);
    setAnnouncement('');
  }

  const visibleItems = loadedRevision === moderation ? items : [];
  const visibleOlder = loadedRevision === moderation ? older : null;
  const replies = saidHere && !visibleItems.some(item => item.id === saidHere.id) ? [...visibleItems, saidHere] : visibleItems;
  return <div className="wall-thread">
    <Message item={root} circuit={circuit} onReply={() => replyTo(root)} expanded={expanded} toggle={() => {
      setExpanded(!expanded);
      if (expanded) setTarget(undefined);
    }} />
    {expanded && <div className="wall-replies" aria-label="Ветка ответов">
      {visibleOlder && <button className="wall-more" type="button" onClick={() => { setLoading(true); void load(visibleOlder); }} disabled={loading}>Более ранние ответы</button>}
      {error && <button className="wall-more" type="button" onClick={() => void load()}>Загрузить ответы ещё раз</button>}
      {loading && !replies.length && root.replyCount > 0 && <span className="wall-loading" role="status">Загружаем ответы…</span>}
      {replies.map(item => <Message item={item} circuit={circuit} key={item.id} onReply={() => replyTo(item)} />)}
      {target && <Composer key={target.id} target={target} cancel={() => {
        setTarget(undefined);
        if (!root.replyCount) setExpanded(false);
      }} editorial={editorial} admin={admin} circuit={circuit}
        sent={() => { setAnnouncement('Ответ опубликован'); setTarget(undefined); }} />}
      <div className="wall-sr" role="status">{announcement}</div>
    </div>}
  </div>;
}

function MessageList({ editorial, admin, circuit }: ThreadProps) {
  const { messages, older, moreRoots, refresh, loadState } = useGreetings();
  const list = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);

  async function earlier() {
    if (!list.current || loading) return;
    setLoading(true);
    setHistoryError(false);
    try { await moreRoots(); } catch { setHistoryError(true); }
    finally { setLoading(false); }
  }

  return <div className="chat-list wall-list" ref={list} aria-label="Сообщения чата" tabIndex={0}>
    {loadState === 'error' && <button type="button" className="wall-more" onClick={() => void refresh()}>Обновить чат</button>}
    {!messages.length && loadState !== 'error' && <div className="wall-empty"><Icon name="chat" size={26} />
      <p>{loadState === 'ready' ? 'Здесь появятся сообщения' : 'Загружаем чат…'}</p></div>}
    {[...messages].reverse().map(item => <Branch key={item.id} root={item} editorial={editorial} admin={admin} circuit={circuit} />)}
    {older && <button type="button" className="wall-more" disabled={loading} onClick={() => void earlier()}>
      {loading ? 'Загружаем…' : 'Более ранние сообщения'}
    </button>}
    {historyError && <p className="wall-loading">Не удалось загрузить историю</p>}
  </div>;
}

export function WallChat({ editorial = false, admin = false, circuit = false, title, footer }: ThreadProps & { title?: string; footer?: ReactNode }) {
  const { open, reopen } = useGreetings();
  const panel = useRef<HTMLDivElement>(null);
  const air = useOptionalOnAir();
  const { choose } = useGreetings();
  function pick(event: MouseEvent<HTMLDivElement>) {
    const point = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-parcel]') : null;
    if (point?.dataset.parcel) choose(point.dataset.parcel);
  }
  const chat = <div ref={panel} id={admin ? undefined : circuit ? 'circuit-wall' : 'greeting-panel'}
    className={'chat-panel wall-panel' + (circuit ? ' circuit-panel' : !admin ? ' greeting-composer' : '')}
    inert={!admin && !circuit && !open}>
    {title && <div className="circuit-chat-title"><h2 id={circuit ? 'circuit-chat-title' : undefined}>{title}</h2></div>}
    <Composer editorial={editorial} admin={admin} circuit={circuit} panel={circuit || admin ? undefined : panel} />
    {circuit && <h3 className="wall-feed-title">Чат эфира</h3>}
    <MessageList editorial={editorial} admin={admin} circuit={circuit} />
    {footer && <div className="circuit-panel-footer">{footer}</div>}
  </div>;
  if (admin) return chat;
  if (circuit) return <div className="circuit-layout wrap">
    <div className="circuit-visual" data-live={air?.motionReady ?? false} onClick={pick} aria-hidden="true">
      <div className="circuit-taps" />
      <div className="circuit-preview" hidden>
        <div className="circuit-preview-leader" />
        {/* eslint-disable-next-line @next/next/no-img-element -- The canvas projection owns this node and sets src and dimensions imperatively. */}
        <div className="circuit-preview-ticket"><img alt="" hidden /><span></span></div>
        <div className="circuit-preview-stamp" />
      </div>
    </div>
    {chat}
  </div>;
  return <div className="greeting-dock" data-open={open}>
    {chat}
    {!open && <div className="wall-packed" role="status"><Icon name="parcel" size={21} />
      <span>Привет отправлен</span><button type="button" onClick={reopen}>Передать ещё</button>
    </div>}
  </div>;
}
