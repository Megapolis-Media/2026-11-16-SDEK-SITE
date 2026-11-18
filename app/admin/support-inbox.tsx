'use client';

import { useEffect, useState } from 'react';
import './support-inbox.css';
import { centralStatuses, centralStatusLabels, centralSupportUrl, type CentralSitePage, type CentralStatus } from '../central-support-types';

const date = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

export function SupportInbox() {
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
