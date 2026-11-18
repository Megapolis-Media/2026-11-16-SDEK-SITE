'use client';

import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { supportDescriptionLimit } from '../support-types';
import type { SupportVisitor, CentralTicket, CentralMessage, CentralMessages } from '../support-bridge-types';
import { Icon } from './icons';
import './support.css';

export function SupportButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return <button type="button" className={compact ? 'air-support' : 'site-support-link'}
    aria-label="Техническая поддержка" aria-haspopup="dialog" aria-controls="technical-support" onClick={onClick}>
    <Icon name="support" size={18} /><span>{compact ? 'Поддержка' : 'Техническая поддержка'}</span>
  </button>;
}

export function SupportDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const open = useSyncExternalStore(useCallback(listener => {
    const dialog = dialogRef.current;
    if (!dialog) return () => {};
    const observer = new MutationObserver(listener);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  }, [dialogRef]), useCallback(() => !!dialogRef.current?.open, [dialogRef]), () => false);
  const submission = useRef<{ key: string; id: string } | null>(null);
  const sending = useRef<{ key: string; id: string } | null>(null);
  const mutation = useRef<AbortController | null>(null);
  const chosen = useRef<number | null>(null);
  const [visitor, setVisitor] = useState<SupportVisitor | null>();
  const [tickets, setTickets] = useState<CentralTicket[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [ticket, setTicket] = useState<CentralTicket | null>(null);
  const [messages, setMessages] = useState<CentralMessage[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState('');
  const [recovery, setRecovery] = useState('');
  const [recoveryInput, setRecoveryInput] = useState('');
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    async function restore() {
      try {
        const session = await bridge<{ visitor: SupportVisitor }>('session', undefined, abort.signal);
        const page = await bridge<TicketPage>('tickets', undefined, abort.signal);
        if (abort.signal.aborted) return;
        setVisitor(session.visitor); setName(session.visitor.name);
        setTickets(page.tickets); setOlder(page.hasMore ? page.nextCursor : null);
        setTicket(page.tickets.find(item => item.id === chosen.current) ?? page.tickets[0] ?? null);
        setMessages([]); setError('');
      } catch (reason) {
        if (abort.signal.aborted) return;
        if (reason instanceof SupportError && reason.code === 'SESSION_INVALID') {
          setVisitor(null); setTicket(null); setTickets([]); setMessages([]); setError('');
        } else setError(reason instanceof Error ? reason.message : 'Не удалось открыть поддержку.');
      }
    }
    void restore();
    return () => { abort.abort(); mutation.current?.abort(); };
  }, [open, reload]);

  const ticketId = ticket?.id;
  useEffect(() => {
    if (!open || !ticketId) return;
    const abort = new AbortController();
    let cursor = 0;
    let failures = 0;
    let pending = false;
    let timer: ReturnType<typeof setTimeout>;
    async function update() {
      clearTimeout(timer);
      if (pending || abort.signal.aborted) return;
      if (document.hidden) { timer = setTimeout(update, 30_000); return; }
      pending = true;
      let delay = 5000;
      try {
        let page: CentralMessages;
        do {
          page = await bridge<CentralMessages>(`tickets/${ticketId}/messages?after=${cursor}`, undefined, abort.signal);
          if (abort.signal.aborted) return;
          if (page.hasMore && page.nextCursor <= cursor) throw new Error('Не удалось загрузить следующую страницу переписки.');
          cursor = page.nextCursor;
          setMessages(previous => mergeMessages(previous, page.messages));
          setTicket(previous => previous?.id === ticketId ? page.ticket : previous);
        } while (page.hasMore);
        failures = 0;
        setError('');
      } catch (reason) {
        if (abort.signal.aborted) return;
        delay = reason instanceof SupportError && reason.status === 429 ? 60_000 : Math.min(60_000, 5000 * 2 ** ++failures);
        setError(reason instanceof Error ? reason.message : 'Связь с поддержкой прервалась.');
      } finally {
        pending = false;
        if (!abort.signal.aborted) timer = setTimeout(update, delay);
      }
    }
    void update();
    document.addEventListener('visibilitychange', update);
    return () => { abort.abort(); clearTimeout(timer); document.removeEventListener('visibilitychange', update); };
  }, [open, ticketId]);

  async function perform(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const abort = new AbortController();
    mutation.current = abort;
    setBusy(true); setError('');
    try { await action(abort.signal); }
    catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : 'Не удалось выполнить запрос.'); }
    finally { if (mutation.current === abort) { mutation.current = null; setBusy(false); } }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!description.trim() || !name.trim()) return;
    await perform(async signal => {
      const session = await bridge<{ visitor: SupportVisitor }>('session', { name: name.trim() }, signal);
      const body = description.trim() + (email.trim() ? '\n\nEmail для связи: ' + email.trim() : '');
      if (submission.current?.key !== body) submission.current = { key: body, id: crypto.randomUUID() };
      const result = await bridge<{ ticket: CentralTicket; messages: CentralMessage[] }>('tickets',
        { subject: 'Обращение с сайта CDEK FM', body, clientRequestId: submission.current.id }, signal);
      if (signal.aborted) return;
      setVisitor(session.visitor);
      setTickets(previous => [result.ticket, ...previous.filter(item => item.id !== result.ticket.id)]);
      chosen.current = result.ticket.id; setTicket(result.ticket); setMessages(result.messages);
      submission.current = null;
      setDescription(''); setRecovery('');
    });
  }

  function reply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !message.trim()) return;
    const current = ticket;
    const body = message.trim();
    const key = current.id + ':' + body;
    if (sending.current?.key !== key) sending.current = { key, id: crypto.randomUUID() };
    const clientMessageId = sending.current.id;
    void perform(async signal => {
      const result = await bridge<{ message: CentralMessage }>(`tickets/${current.id}/messages`, { body, clientMessageId }, signal);
      if (signal.aborted) return;
      setMessages(previous => mergeMessages(previous, [result.message])); setMessage(''); sending.current = null;
    });
  }

  const recover = () => perform(async signal => {
    await bridge('session/recover', { recoveryCode: recoveryInput.trim() }, signal);
    if (!signal.aborted) { setRecoveryInput(''); setReload(value => value + 1); }
  });

  return <dialog ref={dialogRef} id="technical-support" className="site-support-dialog" aria-labelledby="support-title"
    onClose={() => { mutation.current?.abort(); setRecovery(''); }}>
    <header className="site-support-heading">
      <span className="site-support-mark"><Icon name="support" size={22} /></span>
      <h2 id="support-title">Техническая поддержка</h2>
      <button type="button" className="site-support-close" aria-label="Закрыть" onClick={() => dialogRef.current?.close()}>
        <Icon name="close" size={21} />
      </button>
    </header>
    {error && <p className="site-support-error" role="alert">{error} <button type="button" onClick={() => setReload(value => value + 1)} disabled={busy}>Повторить загрузку</button></p>}
    {visitor === undefined ? <p role="status">{error ? 'Поддержка временно недоступна.' : 'Открываем поддержку…'}</p> : <>
    {!!tickets.length && <div className="site-support-form">
      <label>Ваши обращения<select aria-label="Ваши обращения" value={ticket?.id ?? ''} disabled={busy} onChange={event => {
        const selected = tickets.find(item => item.id === Number(event.target.value)) ?? null;
        chosen.current = selected?.id ?? null; setTicket(selected); setMessages([]); setMessage(''); setError('');
      }}><option value="">Новое обращение</option>{tickets.map(item => <option key={item.id} value={item.id}>{item.ticketId}: {item.subject}</option>)}</select></label>
      {older !== null && <button type="button" disabled={busy} onClick={() => void perform(async signal => {
        const page = await bridge<TicketPage>('tickets?before=' + older, undefined, signal);
        if (!signal.aborted) { setTickets(previous => [...previous, ...page.tickets.filter(item => !previous.some(old => old.id === item.id))]); setOlder(page.hasMore ? page.nextCursor : null); }
      })}>Показать прежние обращения</button>}
    </div>}
    {!ticket ? <form className="site-support-form" onSubmit={event => void send(event)}>
      <label>Ваше имя<input name="name" autoComplete="name" maxLength={120} required value={name} readOnly={busy} onChange={event => setName(event.target.value)} /></label>
      <label>Email для ответа
        <input type="email" name="email" autoComplete="email" maxLength={254} value={email} readOnly={busy}
          onChange={event => setEmail(event.currentTarget.value)} />
      </label>
      <label>С чем нужна помощь
        <textarea name="description" rows={5} maxLength={supportDescriptionLimit} required value={description}
          readOnly={busy} onChange={event => setDescription(event.currentTarget.value)} />
      </label>
      <button className="site-support-submit" type="submit" disabled={busy || !description.trim() || !name.trim()}>
        {busy ? 'Отправляем…' : 'Отправить заявку'}
      </button>
    </form> : <div className="site-support-form">
      <p className="site-support-success" role="status">{ticket.ticketId} · {ticket.status === 'CLOSED' ? 'Закрыто' : ticket.status === 'IN_PROGRESS' ? 'В работе' : 'Новое'}</p>
      <ol className="site-support-messages" aria-label="Переписка" aria-live="polite" aria-relevant="additions text">
        {messages.map(item => <li key={item.id}><strong>{item.authorName}</strong><p>{item.body}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('ru-RU')}</time></li>)}
      </ol>
      {ticket.status !== 'CLOSED' ? <form className="site-support-form" onSubmit={reply}>
        <label>Сообщение поддержке<textarea rows={3} maxLength={4000} value={message} required readOnly={busy} onChange={event => setMessage(event.target.value)} /></label>
        <button className="site-support-submit" disabled={busy || !message.trim()}>{busy ? 'Отправляем…' : 'Отправить сообщение'}</button>
      </form> : <p>Переписка сохранена. При необходимости создайте новое обращение.</p>}
    </div>}
    {visitor ? <div className="site-support-form">
      <button type="button" disabled={busy} onClick={() => void perform(async signal => {
        const result = await bridge<{ recoveryCode: string }>('session/recovery-code', {}, signal);
        if (!signal.aborted) setRecovery(result.recoveryCode);
      })}>Получить код восстановления переписки</button>
      {recovery && <label>Код даёт доступ к вашим обращениям. Сохраните его в безопасном месте.<textarea readOnly value={recovery} autoComplete="off" spellCheck={false} /></label>}
      <button type="button" disabled={busy} onClick={() => void perform(async signal => {
        await bridge('session/logout', {}, signal);
        if (!signal.aborted) { setVisitor(null); setTickets([]); setTicket(null); setMessages([]); setRecovery(''); chosen.current = null; }
      })}>Выйти из переписки на этом устройстве</button>
    </div> : <form className="site-support-form" onSubmit={event => { event.preventDefault(); void recover(); }}>
      <label>Код восстановления<input value={recoveryInput} autoComplete="off" maxLength={512} readOnly={busy} onChange={event => setRecoveryInput(event.target.value)} /></label>
      <button type="submit" disabled={busy || !recoveryInput.trim()}>Восстановить переписку</button>
    </form>}
    </>}
  </dialog>;
}

type TicketPage = { tickets: CentralTicket[]; hasMore: boolean; nextCursor: number | null };
class SupportError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}
async function bridge<T>(path: string, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/support-api/' + path, { method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store', credentials: 'same-origin', signal,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json() as { error?: string; code?: string };
  if (!response.ok) throw new SupportError(result.error || 'Не удалось связаться с поддержкой.', response.status, result.code);
  return result as T;
}
function mergeMessages(previous: CentralMessage[], next: CentralMessage[]) {
  const items = new Map(previous.map(item => [item.id, item]));
  next.forEach(item => items.set(item.id, item));
  return [...items.values()].sort((a, b) => a.id - b.id);
}
