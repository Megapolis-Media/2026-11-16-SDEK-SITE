'use client';

import { useEffect, useState } from 'react';
import { supportChannels, supportStatuses, supportStatusLabels, type SupportDelivery, type SupportInboxPage,
  type SupportStatus, type SupportTicket } from '../support-types';
import './support-inbox.css';
import { centralStatuses, centralStatusLabels, centralSupportUrl, type CentralSitePage, type CentralStatus } from '../central-support-types';

const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });
const deliveryLabels: Record<SupportDelivery['state'], string> = {
  pending: 'Ожидает',
  sending: 'Отправляется',
  sent: 'Передано',
  failed: 'Ошибка доставки',
};

type Change = { action: 'status' } & Pick<SupportTicket, 'id' | 'status' | 'updatedAt'>
  | { action: 'email'; email: string }
  | { action: 'retry'; id: string };

export function SupportInbox() {
  const [archiveOpen, setArchiveOpen] = useState(false);
  return <section aria-labelledby="studio-support-title">
    <header className="studio-page-title"><h1 id="studio-support-title">Техническая поддержка</h1></header>
    <section className="studio-card studio-support-hub" aria-labelledby="studio-support-central-title">
      <h2 id="studio-support-central-title">Обращения в центральной поддержке</h2>
      <p>Новые заявки с CDEK FM и переписка с посетителями находятся в единой поддержке сайтов Мегаполис Медиа.</p>
      <a className="studio-publish studio-support-open" href={centralSupportUrl}
        target="_blank" rel="noopener noreferrer">Открыть поддержку сайтов <span aria-hidden="true">↗</span></a>
      <p className="studio-note">Откроется новая вкладка. Войдите под учётной записью сотрудника поддержки и выберите домен cdek-fm.ru.</p>
    </section>
    <CentralSupportFeed />
    <details className="studio-support-archive" open={archiveOpen} onToggle={event => setArchiveOpen(event.currentTarget.open)}>
      <summary>Локальный архив заявок</summary>
      {archiveOpen && <LocalSupportArchive />}
    </details>
  </section>;
}

function CentralSupportFeed() {
  const [filter, setFilter] = useState<CentralStatus | ''>('');
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const before = cursors.at(-1);
  const [page, setPage] = useState<CentralSitePage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        if (document.visibilityState === 'hidden') return;
        const query = new URLSearchParams();
        if (filter) query.set('status', filter);
        if (before) query.set('before', String(before));
        const response = await fetch('/api/admin/support/central?' + query, { cache: 'no-store', signal: controller.signal });
        const data = await response.json() as CentralSitePage & { error?: string };
        if (!response.ok) throw new Error(data.error || 'Не удалось загрузить заявки.');
        if (!controller.signal.aborted) {
          setPage(data); setError(''); setCheckedAt(Date.now());
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить заявки.');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          timer = setTimeout(() => void load(), 15_000);
        }
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [filter, before, refresh]);

  return <section className="studio-card studio-support-central" aria-labelledby="central-tickets-title" aria-busy={loading}>
    <header className="studio-support-toolbar">
      <h2 id="central-tickets-title">Заявки с сайта</h2>
      <label className="studio-field"><span>Статус заявок</span>
        <select value={filter} onChange={event => {
          setFilter(event.currentTarget.value as CentralStatus | ''); setCursors([null]); setPage(null); setError(''); setLoading(true);
        }}>
          <option value="">Все заявки</option>
          {centralStatuses.map(status => <option value={status} key={status}>{centralStatusLabels[status]}</option>)}
        </select>
      </label>
      <button className="studio-secondary" disabled={loading} onClick={() => { setLoading(true); setRefresh(value => value + 1); }}>Обновить</button>
    </header>
    {error && <p className="studio-error" role="alert">{error}{page ? ' Ниже показаны последние загруженные данные.' : ''}</p>}
    {loading && !page && <p className="studio-note" role="status">Загрузка заявок…</p>}
    {page && <>
      <p className="studio-note">{checkedAt ? `Обновлено ${date.format(checkedAt)} Мск. ` : ''}Статусы обновляются автоматически.</p>
      <div className="studio-support-feed">
        {!page.tickets.length && <p className="studio-note">{filter ? 'Заявок с этим статусом нет.' : 'С этого сайта пока нет обращений в поддержку.'}</p>}
        {page.tickets.map(ticket => <article className="studio-support-ticket" key={ticket.id} aria-labelledby={'central-ticket-' + ticket.id}>
          <header>
            <h3 id={'central-ticket-' + ticket.id}>{ticket.ticketId}</h3>
            <span className="studio-support-status" data-status={ticket.status}>{centralStatusLabels[ticket.status]}</span>
          </header>
          <p className="studio-support-description">{ticket.subject}</p>
          <p className="studio-support-sender">От: <strong>{ticket.visitorName}</strong></p>
          <time dateTime={ticket.createdAt}>{date.format(new Date(ticket.createdAt))} Мск</time>
          <div><a className="studio-support-ticket-link" href={`${centralSupportUrl}#tickets&ticket=${ticket.id}`}
            target="_blank" rel="noopener noreferrer" aria-label={`Открыть ${ticket.ticketId} на платформе поддержки (новая вкладка)`}>
            Открыть тикет <span aria-hidden="true">↗</span></a></div>
        </article>)}
      </div>
      <nav className="studio-support-pagination" aria-label="Страницы заявок поддержки">
        {cursors.length > 1 && <button className="studio-secondary" disabled={loading} onClick={() => {
          setCursors(value => value.slice(0, -1)); setPage(null); setError(''); setLoading(true);
        }}>Назад</button>}
        {page.hasMore && page.nextCursor && <button className="studio-secondary" disabled={loading} onClick={() => {
          setCursors(value => [...value, page.nextCursor]); setPage(null); setError(''); setLoading(true);
        }}>Следующие заявки</button>}
      </nav>
    </>}
  </section>;
}

function LocalSupportArchive() {
  const [page, setPage] = useState<SupportInboxPage | null>(null);
  const [draftEmail, setDraftEmail] = useState<string | null>(null);
  const [filter, setFilter] = useState<SupportStatus | ''>('');
  const [cursors, setCursors] = useState<(number | null)[]>([null]);
  const before = cursors.at(-1);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [feedError, setFeedError] = useState('');
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    const control = new AbortController();
    const query = new URLSearchParams();
    if (filter) query.set('status', filter);
    if (before) query.set('before', String(before));
    let pending = false;
    async function load() {
      if (pending || control.signal.aborted) return;
      pending = true;
      try {
        const result = await fetch('/api/admin/support?' + query, { cache: 'no-store', signal: control.signal });
        const data = await result.json() as SupportInboxPage & { error?: string };
        if (control.signal.aborted) return;
        if (!result.ok) {
          setFeedError(data.error || 'Не удалось загрузить заявки.');
          return;
        }
        setPage(data);
        setFeedError('');
      } catch {
        if (!control.signal.aborted) setFeedError('Не удалось загрузить заявки.');
      } finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(() => { if (!document.hidden) void load(); }, 12_000);
    return () => { control.abort(); window.clearInterval(timer); };
  }, [before, filter, refresh]);

  async function update(change: Change) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/support', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change),
      });
      const data = await response.json() as { settings?: SupportInboxPage['settings']; error?: string };
      if (!response.ok) {
        setNotice({ error: true, text: data.error || 'Не удалось сохранить изменения.' });
        return;
      }
      const { settings } = data;
      if (change.action === 'email' && settings) {
        setPage(previous => previous && { ...previous, settings });
        setDraftEmail(null);
        setNotice({ text: 'Настройки доставки сохранены.' });
      }
    } catch {
      setNotice({ error: true, text: 'Связь прервалась. Попробуйте ещё раз.' });
    } finally {
      setRefresh(value => value + 1);
      setBusy(false);
    }
  }

  const settings = page?.settings;
  const email = draftEmail ?? settings?.email ?? '';
  return <section aria-label="Локальный архив заявок">
    <p className="studio-note">Здесь сохранены обращения прежней локальной формы. Новые заявки и ответы операторов доступны по ссылке в центральной поддержке выше.</p>
    {notice && <p className={'studio-status-message' + (notice.error ? ' studio-error' : '')} role="status">{notice.text}</p>}
    <div className="studio-support-layout">
      <section className="studio-card" aria-labelledby="studio-support-feed-title">
        <div className="studio-support-toolbar">
          <h2 id="studio-support-feed-title">Заявки локального архива</h2>
          <label className="studio-field"><span>Статус заявок</span>
            <select value={filter} disabled={busy} onChange={event => {
              setPage(null);
              setFilter(event.currentTarget.value as SupportStatus | '');
              setCursors([null]);
            }}>
              <option value="">Все заявки</option>
              {supportStatuses.map(status => <option key={status} value={status}>
                {supportStatusLabels[status]}{page ? ` (${page.counts[status]})` : ''}
              </option>)}
            </select>
          </label>
          <button className="studio-secondary" type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Обновить</button>
        </div>
        {feedError && <p className="studio-note" role="alert">{feedError}</p>}
        {!page && !feedError && <p className="studio-note" role="status">Загружаем заявки…</p>}
        {page?.tickets.length === 0 && <p className="studio-note">Локальных заявок с выбранным статусом нет. Новые обращения находятся в центральной поддержке.</p>}
        <div className="studio-support-feed">
          {page?.tickets.map(ticket => {
            const canRetry = ticket.deliveries.some(delivery => delivery.state !== 'sent' &&
              (delivery.channel === 'email' ? settings?.mailReady && settings.email : settings?.helpdeskReady));
            return <article className="studio-support-ticket" key={ticket.id} aria-labelledby={'support-ticket-' + ticket.id}>
              <header>
                <h3 id={'support-ticket-' + ticket.id}>Заявка №{ticket.number}</h3>
                <time dateTime={new Date(ticket.createdAt).toISOString()}>{date.format(ticket.createdAt)} Мск</time>
              </header>
              <a className="studio-support-address" href={'mailto:' + ticket.email}>{ticket.email}</a>
              <p className="studio-support-description">{ticket.description}</p>
              <div className="studio-support-actions">
                <label className="studio-field"><span>Статус заявки</span>
                  <select value={ticket.status} disabled={busy} onChange={event => void update({
                    action: 'status', id: ticket.id, updatedAt: ticket.updatedAt, status: event.currentTarget.value as SupportStatus,
                  })}>
                    {supportStatuses.map(status => <option key={status} value={status}>{supportStatusLabels[status]}</option>)}
                  </select>
                </label>
                <div className="studio-support-deliveries" aria-label="Доставка заявки" role="group">
                  {supportChannels.map(channel => {
                    const state = ticket.deliveries.find(delivery => delivery.channel === channel)?.state ?? 'pending';
                    return <span key={channel} data-state={state}>{channel === 'email' ? 'Почта' : 'Helpdesk'} · {deliveryLabels[state]}</span>;
                  })}
                </div>
                {canRetry && <button className="studio-secondary" type="button" disabled={busy}
                  onClick={() => void update({ action: 'retry', id: ticket.id })}>Повторить доставку</button>}
              </div>
            </article>;
          })}
        </div>
        {(cursors.length > 1 || page?.nextBefore != null) && <nav className="studio-support-pagination" aria-label="Страницы заявок">
          <button className="studio-secondary" type="button" disabled={cursors.length < 2 || busy} onClick={() => {
            setCursors(previous => previous.slice(0, -1));
            setPage(null);
          }}>Новые</button>
          <button className="studio-secondary" type="button" disabled={page?.nextBefore == null || busy} onClick={() => {
            if (page?.nextBefore == null) return;
            setCursors(previous => [...previous, page.nextBefore]);
            setPage(null);
          }}>Ранние</button>
        </nav>}
      </section>
      <section className="studio-card" aria-labelledby="studio-support-delivery-title">
        <h2 id="studio-support-delivery-title">Доставка локальных заявок</h2>
        <p className="studio-note">Эти настройки относятся только к прежней локальной очереди. Подключение центральной поддержки настраивается отдельно.</p>
        <form className="studio-support-settings" onSubmit={event => { event.preventDefault(); void update({ action: 'email', email: email.trim() }); }}>
          <label className="studio-field"><span>Куда отправлять копии</span>
            <input type="email" autoComplete="off" maxLength={254} placeholder="support@example.com" value={email}
              disabled={!settings || busy} onChange={event => setDraftEmail(event.currentTarget.value)} />
          </label>
          <button className="studio-publish" type="submit" disabled={!settings || busy || email.trim() === settings.email}>Сохранить email</button>
        </form>
        <dl className="studio-support-connections">
          <div><dt>Почтовый сервис</dt><dd>{settings ? settings.mailReady ? 'Подключён' : 'Нужна настройка' : '—'}</dd></div>
          <div><dt>Webhook helpdesk</dt><dd>{settings ? settings.helpdeskReady ? 'Настроен' : 'Нужна настройка' : '—'}</dd></div>
          <div><dt>Доступ к API</dt><dd>{settings ? settings.apiReady ? 'Токен задан' : 'Нужен токен' : '—'}</dd></div>
        </dl>
      </section>
    </div>
  </section>;
}
