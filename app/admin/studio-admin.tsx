'use client';

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { editorName, type GreetingMessage, type TrackItem } from '../chat-types';
import { GreetingProvider, useGreetings } from '../cinematic/greetings';
import { Icon } from '../cinematic/icons';
import { WallChat } from '../cinematic/wall-chat';
import type { Report } from '../server/reports';
import {
  displayBlocks, blockLabels, blockPresentation, phaseLabels, phases, studioSchema, visualLabels,
  type Block, type Contacts, type Edition, type Phase, type Studio, type StudioDocument,
} from '../studio-config';
import { SupportInbox } from './support-inbox';
import '../cinematic/chat.css';

type SVGName = 'settings' | 'chat' | 'stats' | 'meter' | 'external' | 'arrow' | 'download' | 'check' | 'radio' | 'video' | 'music' | 'eye' | 'clock' | 'phone' | 'logout';
const paths: Record<SVGName, ReactNode> = {
  settings: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  chat: <path d="M21 11.5a8 8 0 0 1-8 8H4l1.5-4a8 8 0 1 1 15.5-4Z" />,
  stats: <><path d="M4 4v16h16M8 16v-4m5 4V8m5 8V5" /></>,
  meter: <><path d="M4 17a8 8 0 1 1 16 0H4zM12 14l4-4M7 13h1m4-5v1m5 4h1" /></>,
  external: <path d="M13 5h6v6m0-6L9 15m9-1v5H5V6h5" />,
  arrow: <path d="m9 6 6 6-6 6" />,
  download: <path d="M12 4v11m-4-4 4 4 4-4m-11 6v3h14v-3" />,
  check: <path d="m5 12 4 4L19 6" />,
  radio: <><rect x="3" y="8" width="18" height="12" rx="2" /><circle cx="15" cy="14" r="2.6" /><path d="m6 8 10-5M7 12h2m-2 4h2" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m10 9 5 3-5 3Z" /></>,
  music: <><path d="M10 18V5l10-2v13m-10-7 10-2"/><ellipse cx="7" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  phone: <path d="M8 4H5a1 1 0 0 0-1 1 15 15 0 0 0 15 15 1 1 0 0 0 1-1v-3l-5-2-1.5 2a11 11 0 0 1-5.5-5.5L10 9Z" />,
  logout: <path d="M11 4H5v16h6m4-12 4 4-4 4m4-4H9" />,
};
function Glyph({ name, size = 19 }: { name: SVGName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
    {paths[name]}
  </svg>;
}

const tabs = [
  { id: 'settings', text: 'Настройки сайта', icon: 'settings' },
  { id: 'contacts', text: 'Контакты', icon: 'phone' },
  { id: 'chat', text: 'Чат и заявки', icon: 'chat' },
  { id: 'support', text: 'Техподдержка', icon: 'support' },
  { id: 'stats', text: 'Статистика', icon: 'stats' },
  { id: 'metrics', text: 'Яндекс.Метрика', icon: 'meter' },
] as const;
type Tab = typeof tabs[number]['id'];

function Field({ label, value, onChange, limit, long, type = 'text', placeholder }: {
  label: string; value: string; onChange: (value: string) => void; limit?: number;
  long?: boolean; type?: 'text' | 'url' | 'tel'; placeholder?: string;
}) {
  return <label className="studio-field"><span>{label}</span>
    {long ? <textarea rows={2} value={value} maxLength={limit} placeholder={placeholder}
      onChange={event => onChange(event.target.value)} /> :
      <input type={type} value={value} maxLength={limit} placeholder={placeholder}
        onChange={event => onChange(event.target.value)} />}
  </label>;
}

function Switch({ checked, onChange, label, icon }: { checked: boolean; onChange: (checked: boolean) => void; label: string; icon?: SVGName }) {
  return <label className="studio-switch">
    {icon && <span className="studio-switch-icon"><Glyph name={icon} size={18} /></span>}
    <span>{label}</span>
    <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span className="studio-switch-rail" aria-hidden="true" />
  </label>;
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return <section className="studio-card">
    <div className="studio-card-head"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    {children}
  </section>;
}

function blockText(edition: Edition, id: Block, update: (change: Partial<Edition>) => void): ReactNode {
  switch (id) {
    case 'broadcast': return <>
      <div className="studio-fields two">
        <Field label="Заголовок" value={edition.hero.title} limit={54} onChange={title => update({ hero: { ...edition.hero, title } })} />
        <Field label="Выделение зелёным" value={edition.hero.accent} limit={54} onChange={accent => update({ hero: { ...edition.hero, accent } })} />
      </div>
      <Field label="Подзаголовок" value={edition.hero.description} limit={190} long onChange={description => update({ hero: { ...edition.hero, description } })} />
      <Field label="Дата и время" value={edition.hero.date} limit={100} onChange={date => update({ hero: { ...edition.hero, date } })} />
    </>;
    case 'activities': return <div className="studio-fields two">
      <Field label="Приглашение на трансляцию" value={edition.activities.watch} limit={100} onChange={watch => update({ activities: { ...edition.activities, watch } })} />
      <Field label="Время трансляции" value={edition.activities.when} limit={100} onChange={when => update({ activities: { ...edition.activities, when } })} />
      <Field label="Приглашение позвонить" value={edition.activities.call} limit={100} onChange={call => update({ activities: { ...edition.activities, call } })} />
      <Field label="Приглашение передать привет" value={edition.activities.greetings} limit={100} onChange={greetings => update({ activities: { ...edition.activities, greetings } })} />
    </div>;
    case 'television': return <div className="studio-fields two">
      <Field label="Заголовок" value={edition.television.title} limit={75} onChange={title => update({ television: { ...edition.television, title } })} />
      <Field label="Выделение зелёным" value={edition.television.accent} limit={65} onChange={accent => update({ television: { ...edition.television, accent } })} />
    </div>;
    case 'chat': return <div className="studio-fields two">
      <Field label="Заголовок" value={edition.greetings.title} limit={90} onChange={title => update({ greetings: { ...edition.greetings, title } })} />
      <Field label="Выделение зелёным" value={edition.greetings.accent} limit={90} onChange={accent => update({ greetings: { ...edition.greetings, accent } })} />
      <Field label="Конец заголовка" value={edition.greetings.ending} limit={90} onChange={ending => update({ greetings: { ...edition.greetings, ending } })} />
      <Field label="Подзаголовок" value={edition.greetings.subtitle} limit={120} onChange={subtitle => update({ greetings: { ...edition.greetings, subtitle } })} />
    </div>;
    case 'archive': return <>
      <Field label="Заголовок раздела" value={edition.archive.title} limit={90} onChange={title => update({ archive: { ...edition.archive, title } })} />
      {(['december', 'february'] as const).map((id, i) => {
        const item = edition.archive[id];
        const change = (next: Partial<typeof item>) => update({ archive: { ...edition.archive, [id]: { ...item, ...next } } });
        return <section className="studio-archive" key={id}>
          <h3>Запись {i + 1}</h3>
          <div className="studio-fields two">
            <Field label="Название" value={item.title} limit={100} onChange={title => change({ title })} />
            <Field label="Подпись" value={item.date} limit={160} onChange={date => change({ date })} />
          </div>
          <Field label="Ссылка на запись" value={item.url} type="url" limit={1800} onChange={url => change({ url })} />
          <Switch label="Открывать внутри сайта" checked={item.embedded} onChange={embedded => change({ embedded })} />
        </section>;
      })}
    </>;
    case 'circuit-chat': return <Field label="Заголовок" value={edition.circuitTitle} limit={100} onChange={circuitTitle => update({ circuitTitle })} />;
  }
}

function BlockPreview({ edition, current, phase }: { edition: Edition; current: Block; phase: Phase }) {
  const block = blockPresentation(edition, current);
  const copy: Record<Block, { title: string; accent?: string; detail?: string }> = {
    broadcast: { title: edition.hero.title, accent: edition.hero.accent, detail: edition.hero.description },
    activities: { title: edition.activities.watch, detail: edition.activities.when },
    television: { title: edition.television.title, accent: edition.television.accent },
    chat: { title: edition.greetings.title, accent: edition.greetings.accent + ' ' + edition.greetings.ending, detail: edition.greetings.subtitle },
    archive: { title: edition.archive.title, detail: edition.archive.december.title },
    'circuit-chat': { title: edition.circuitTitle },
  };
  const { title, accent, detail } = copy[current];
  return <aside className="studio-preview">
    <section className="studio-card">
      <div className="studio-preview-title"><Glyph name="eye" size={18} /><h2>Предпросмотр</h2></div>
      <div className="studio-scene" data-look={block.visual} data-visible={block.visible}>
        <img className="studio-scene-logo" src="/visual/cdek-fm.svg" alt="СДЭК FM" width="79" height="14" />
        {block.visible ? <>
          <div className="studio-scene-copy"><strong>{title} {accent && <em>{accent}</em>}</strong>{detail && <p>{detail}</p>}</div>
          {current === 'broadcast' && <span className="studio-scene-date"><Glyph name="clock" size={13} />{edition.hero.date}</span>}
        </> : <div className="studio-scene-copy"><p>Блок скрыт</p></div>}
      </div>
      <div className="studio-preview-foot"><span>{blockLabels[current]}</span><span>{phaseLabels[phase]}</span></div>
    </section>
    <section className="studio-card studio-checklist">
      <div className="studio-preview-title"><h2>Что доступно на сайте</h2></div>
      {([
        ['Радио', edition.radioEnabled, 'radio'], ['Телетрансляция', edition.tvEnabled && edition.blocks.television.visible, 'video'],
        ['Чат', edition.blocks.chat.visible || edition.blocks['circuit-chat'].visible, 'chat'],
        ['Заказ песен', edition.tracksEnabled, 'music'],
      ] as const).map(([label, enabled, icon]) => <div key={label}>
        <span><Glyph name={icon} size={16} />{label}</span>
        <strong data-enabled={enabled}>{enabled ? 'Включено' : 'Выключено'}</strong>
      </div>)}
    </section>
  </aside>;
}

function SiteSettings({ phase, setPhase, draft, published, update, activate, block, setBlock }: {
  phase: Phase; setPhase: (phase: Phase) => void; draft: Studio; published: Phase; update: (change: Partial<Edition>) => void;
  activate: () => void; block: Block; setBlock: (id: Block) => void;
}) {
  const edition = draft.editions[phase];
  const style = blockPresentation(edition, block);
  function design(change: Partial<typeof style>) {
    const next = { ...style, ...change };
    update({ blocks: { ...edition.blocks, [block]: next, ...(block === 'circuit-chat' ? { chat: next } : {}) } });
  }
  return <>
    <div className="studio-page-title"><h1>Настройки сайта</h1><p>Выберите режим, отредактируйте сайт и нажмите «Опубликовать».</p></div>
    <div className="studio-phase-bar" aria-label="Режимы эфира">
      {phases.map(key => <button key={key} className="studio-phase" type="button" aria-pressed={phase === key} onClick={() => setPhase(key)}>
        <span className="studio-phase-label">{phaseLabels[key]}</span>
        <span className="studio-phase-state" data-on={draft.active === key}>
          {published === key ? 'Сейчас на сайте' : draft.active === key ? 'После публикации' : 'Настройки режима'}
        </span>
      </button>)}
    </div>
    <div className="studio-editor-grid">
      <div className="studio-editor-stack">
        <Card title={phaseLabels[phase]}>
          <div className="studio-mode">
            <span>{draft.active === phase ? (published === phase ? 'Этот режим видят посетители' : 'Этот режим станет активным после публикации') : 'Посетители сейчас видят режим «' + phaseLabels[published] + '»'}</span>
            {draft.active !== phase && <button type="button" className="studio-secondary" onClick={activate}>Сделать активным</button>}
          </div>
          <div className="studio-media">
            <Switch icon="radio" label="Интернет-радио" checked={edition.radioEnabled} onChange={radioEnabled => update({ radioEnabled })} />
            <Switch icon="video" label="Телетрансляция" checked={edition.tvEnabled} onChange={tvEnabled => update({
              tvEnabled, ...(tvEnabled ? { blocks: { ...edition.blocks, television: { ...edition.blocks.television, visible: true } } } : {}),
            })} />
            <Switch icon="music" label="Заказ песен" checked={edition.tracksEnabled} onChange={tracksEnabled => update({ tracksEnabled })} />
          </div>
          <details className="studio-stream-links"><summary>Ссылки на радио и Facecast</summary>
            <div className="studio-fields two">
              <Field label="Ссылка на аудиопоток" value={edition.radioUrl} type="url" limit={1800} onChange={radioUrl => update({ radioUrl })} />
              <Field label="Ссылка на Facecast" value={edition.tvUrl} type="url" limit={1800} onChange={tvUrl => update({ tvUrl })} />
            </div>
          </details>
        </Card>
        <Card title="Тексты и графика">
          <div className="studio-block-choices" aria-label="Блоки сайта">
            {displayBlocks.map(id => <button key={id} type="button" aria-pressed={block === id} onClick={() => setBlock(id)}>{blockLabels[id]}</button>)}
          </div>
          <div className="studio-block-fields">
            <div className="studio-fields two studio-design-fields">
              <Switch label="Показывать блок" checked={style.visible} onChange={visible => design({ visible })} />
              <label className="studio-field"><span>Графика</span>
                <select value={style.visual} onChange={event => design({ visual: event.target.value as typeof style.visual })}>
                  {Object.entries(visualLabels).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
              </label>
            </div>
            {blockText(edition, block, update)}
          </div>
        </Card>
      </div>
      <BlockPreview edition={edition} current={block} phase={phase} />
    </div>
  </>;
}

const counts = new Intl.NumberFormat('ru');
const date = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const downloads = [
  { id: 'participants', text: 'Участники чата', detail: 'Имена и активность' },
  { id: 'activity', text: 'Статистика по дням', detail: 'Сообщения и заявки' },
  { id: 'tracks', text: 'Заявки на песни', detail: 'Песни и статусы' },
];

function FileLink({ id, text }: { id: string; text: string }) {
  return <a className="studio-download" href={'/api/admin/report?download=' + id} aria-label={'Скачать CSV · ' + text}>
    <Glyph name="download" size={17} /><span>CSV</span>
  </a>;
}

function Stats({ data, error, reload }: { data: Report | null; error: boolean; reload: () => void }) {
  const metrics = [
    ['Сообщения', data?.totals.messages, 'chat'],
    ['Участники', data?.totals.authors, 'settings'],
    ['Заявки на песни', data?.totals.tracks, 'music'],
    ['Картинки в чате', data?.totals.images, 'eye'],
  ] as const;
  return <>
    <div className="studio-page-title"><h1>Статистика</h1><p>Активность чата и заявки на песни. Даты и время по Москве.</p></div>
    {error && <p className="studio-error" role="status">Не удалось загрузить статистику. <button className="studio-secondary" onClick={reload}>Обновить</button></p>}
    <div className="studio-metrics">
      {metrics.map(([label, value, icon]) => <div className="studio-card studio-number" key={label}><Glyph name={icon} />
        <strong>{value === undefined ? '—' : counts.format(value)}</strong><span>{label}</span>
      </div>)}
    </div>
    <div className="studio-editor-grid studio-stats-grid">
      <Card title="Последние 30 дней">
        <div className="studio-table-wrap" tabIndex={0} aria-label="Статистика по дням"><table className="studio-table">
          <thead><tr><th scope="col">Дата</th><th scope="col">Сообщения</th><th scope="col">Ответы</th><th scope="col">Картинки</th><th scope="col">Песни</th></tr></thead>
          <tbody>{data?.days.map(day => <tr key={day.day}><th scope="row">{day.day.split('-').reverse().join('.')}</th>
            <td>{day.messages}</td><td>{day.replies}</td><td>{day.images}</td><td>{day.tracks}</td>
          </tr>)}</tbody>
        </table>{!data && !error && <p className="studio-placeholder">Загружаем статистику…</p>}</div>
      </Card>
      <Card title="Выгрузки" subtitle="Данные за всё время">
        {downloads.map(({ id, text, detail }) => <div className="studio-export" key={id}>
          <div><strong>{text}</strong><span>{detail}</span></div><FileLink id={id} text={text} />
        </div>)}
        <p className="studio-note">Участники без входа учитываются по браузеру. Архивные сообщения выгружаются с отметкой «Гость (архив)».</p>
      </Card>
    </div>
  </>;
}

type ModerationPage = { messages: GreetingMessage[]; older: string | null };

function ChatModeration({ onModerated }: { onModerated: () => void }) {
  const { refresh } = useGreetings();
  const [page, setPage] = useState<ModerationPage>();
  const [selected, setSelected] = useState(() => new Set<string>());
  const [confirm, setConfirm] = useState<'selected' | 'all'>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);

  const load = useCallback(async (before?: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/admin/chat' + (before ? '?before=' + before : ''), { cache: 'no-store', signal });
      if (!response.ok) throw new Error();
      const result: ModerationPage = await response.json();
      if (signal?.aborted) return;
      setPage(previous => before && previous
        ? { messages: [...previous.messages, ...result.messages], older: result.older } : result);
      if (!before) setSelected(new Set());
    } catch { if (!signal?.aborted) setError(true); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(undefined, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function remove() {
    if (!confirm || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/admin/chat', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(confirm === 'all' ? { clear: true } : { ids: [...selected] }),
      });
      if (!response.ok) throw new Error();
      const result = await response.json() as { deleted: number; attachmentsRemoved: boolean };
      setConfirm(undefined);
      setNotice(result.attachmentsRemoved ? `Сообщений удалено — ${result.deleted}.`
        : `Сообщений удалено — ${result.deleted}. Хранилище не подтвердило удаление всех вложений.`);
      void refresh();
      onModerated();
      await load();
    } catch { setNotice('Не удалось удалить сообщения. Обновите список и попробуйте снова.'); }
    finally { setBusy(false); }
  }

  const locked = loading || busy || Boolean(confirm);
  return <Card title="Управление сообщениями">
    <div className="studio-moderation-actions">
      <button type="button" className="studio-secondary" disabled={locked} onClick={() => void load()}>Обновить список</button>
      <button type="button" className="studio-secondary" disabled={locked || !selected.size}
        onClick={() => { setNotice(''); setConfirm('selected'); }}>Удалить выбранные{selected.size ? ` (${selected.size})` : ''}</button>
      <button type="button" className="studio-danger" disabled={locked || !page?.messages.length}
        onClick={() => { setNotice(''); setConfirm('all'); }}>Очистить весь чат</button>
    </div>
    {confirm && <div className="studio-moderation-confirm" role="group" aria-label="Подтверждение удаления">
      <strong>{confirm === 'all' ? 'Очистить весь чат?' : `Удалить отмеченные сообщения (${selected.size})?`}</strong>
      <p>{confirm === 'all' ? 'Будут удалены все сообщения, ответы и фото.' : 'Ответы к отмеченным сообщениям и их вложения тоже будут удалены.'}</p>
      <div className="studio-moderation-actions">
        <button type="button" className="studio-secondary" disabled={busy} onClick={() => setConfirm(undefined)}>Отмена</button>
        <button type="button" className="studio-danger" disabled={busy} onClick={() => void remove()}>
          {busy ? 'Удаляем…' : confirm === 'all' ? 'Подтвердить очистку' : 'Подтвердить удаление'}
        </button>
      </div>
    </div>}
    {notice && <p className="studio-note" role="status">{notice}</p>}
    {error && <p className="studio-note studio-error" role="status">Не удалось загрузить список. Нажмите «Обновить список».</p>}
    {!page && loading && <p className="studio-placeholder" role="status">Загружаем сообщения…</p>}
    {page?.messages.length === 0 && <p className="studio-placeholder">Чат пуст</p>}
    {!!page?.messages.length && <div className="studio-moderation-list" role="group" aria-label="Сообщения для удаления">
      {page.messages.map(item => <label className="studio-moderation-row" key={item.id}>
        <input type="checkbox" checked={selected.has(item.id)} disabled={locked}
          aria-label={`Выбрать сообщение от ${item.authorName}`} onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(previous => {
              const next = new Set(previous);
              if (checked) next.add(item.id);
              else next.delete(item.id);
              return next;
            });
          }} />
        <span><strong>{item.authorName}</strong><small>{date.format(item.createdAt)}{item.threadId ? ' · Ответ' : ''}</small>
          <span>{item.body || 'Фото'}</span></span>
        {item.imageUrl && <img src={item.imageUrl} alt="Фото" width={46} height={40} loading="lazy" />}
      </label>)}
    </div>}
    {page?.older && <button type="button" className="studio-secondary" disabled={locked}
      onClick={() => void load(page.older ?? undefined)}>Более ранние сообщения</button>}
  </Card>;
}

function Inbox({ data, error, reload }: { data: Report | null; error: boolean; reload: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState('');
  async function mark(item: TrackItem) {
    setBusy(item.id);
    setNotice('');
    try {
      const response = await fetch('/api/admin/tracks', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id, accepted: !item.acceptedAt }),
      });
      if (!response.ok) throw new Error();
      reload();
    } catch { setNotice('Не удалось обновить заявку. Попробуйте снова.'); }
    finally { setBusy(undefined); }
  }
  return <>
    <div className="studio-page-title"><h1>Чат и заявки</h1><p>Пишите в чат от имени редакции и принимайте заявки на песни.</p></div>
    <GreetingProvider eager>
    <div className="studio-inbox">
      <Card title="Чат"><WallChat editorial admin /></Card>
      <div className="studio-inbox-column">
        <ChatModeration onModerated={reload} />
        <Card title="Заявки на песни" subtitle={data ? 'Ожидают рассмотрения · ' + data.totals.pending : undefined}>
        {error && <button className="studio-secondary" type="button" onClick={reload}>Загрузить заявки ещё раз</button>}
        {!error && !data && <p className="studio-placeholder">Загружаем заявки…</p>}
        {data?.tracks.length === 0 && <div className="studio-empty"><Glyph name="music" size={28} /><p>Заявок пока нет</p></div>}
        {notice && <p className="studio-error" role="status">{notice}</p>}
        {data?.tracks.map(item => <div className="studio-track" key={item.id}>
          <div><strong>{item.title}</strong>{item.artist && <span>{item.artist}</span>}<small>{item.authorName} · {date.format(item.createdAt)}</small></div>
          <button className="studio-secondary" type="button" data-accepted={!!item.acceptedAt} aria-pressed={!!item.acceptedAt}
            disabled={busy !== undefined} onClick={() => void mark(item)}>{item.acceptedAt ? 'Принята' : busy === item.id ? 'Сохраняем…' : 'Принять'}</button>
        </div>)}
        <div className="studio-export"><strong>Скачать все заявки</strong><FileLink id="tracks" text="Заявки на песни" /></div>
        </Card>
      </div>
    </div>
    </GreetingProvider>
  </>;
}

function ContactSettings({ value, change }: { value: Contacts; change: (patch: Partial<Contacts>) => void }) {
  return <>
    <div className="studio-page-title"><h1>Контакты</h1><p>Выберите способы связи и нажмите «Опубликовать».</p></div>
    <div className="studio-contact-grid">
      <Card title="Звонок в эфир">
        <Switch label="Показывать кнопку звонка" checked={value.phoneEnabled} onChange={phoneEnabled => change({ phoneEnabled })} />
        <Field label="Номер для звонков" value={value.phoneNumber} type="tel" limit={32}
          onChange={phoneNumber => change({ phoneNumber })} />
        <p className="studio-note">При нажатии на телефоне открывается набор этого номера.</p>
      </Card>
      <Card title="Мессенджеры">
        <Field label="Номер для мессенджеров" value={value.messengerNumber} type="tel" limit={32}
          onChange={messengerNumber => change({ messengerNumber })} />
        <Switch label="Показывать Telegram" checked={value.telegramEnabled} onChange={telegramEnabled => change({ telegramEnabled })} />
        <Field label="Ссылка на чат Telegram" value={value.telegramUrl} type="url" limit={1800} placeholder="https://t.me/…"
          onChange={telegramUrl => change({ telegramUrl })} />
        <Switch label="Показывать MAX" checked={value.maxEnabled} onChange={maxEnabled => change({ maxEnabled })} />
        <Field label="Ссылка-приглашение MAX" value={value.maxUrl} type="url" limit={1800} placeholder="https://max.ru/…"
          onChange={maxUrl => change({ maxUrl })} />
        <p className="studio-note">В MAX выберите «Контакты» → «+» → «Пригласить по ссылке».</p>
      </Card>
    </div>
  </>;
}

function Metrics({ value, change }: { value: string; change: (id: string) => void }) {
  return <>
    <div className="studio-page-title"><h1>Яндекс.Метрика</h1><p>Счётчик посещений и действий на публичном сайте.</p></div>
    <div className="studio-metrika-grid">
      <Card title="Счётчик">
        <label className="studio-field"><span>Номер счётчика</span>
          <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={12} value={value} placeholder="Например, 12345678"
            onChange={event => change(event.target.value.replace(/\D/g, ''))} />
        </label>
        <p className="studio-note">Введите номер из Яндекс.Метрики и опубликуйте изменения. Оставьте поле пустым, чтобы отключить счётчик.</p>
      </Card>
      <Card title="Действия для целей">
        {[['Сообщение в чате', 'chat_message'], ['Заявка на песню', 'track_request'],
          ['Нажатие Play', 'radio_play'], ['Открытие телетрансляции', 'video_open']].map(([label, name]) =>
          <div className="studio-export" key={name}><strong>{label}</strong><code>{name}</code></div>)}
      </Card>
    </div>
  </>;
}

function tabFromHash(): Tab {
  return tabs.find(item => '#' + item.id === window.location.hash)?.id ?? 'settings';
}

export function StudioAdmin({ initial }: { initial: StudioDocument }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial.studio);
  const [phase, setPhase] = useState<Phase>(initial.studio.active);
  const [block, setBlock] = useState<Block>('broadcast');
  const [tab, setTab] = useState<Tab>('settings');
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const [conflict, setConflict] = useState<StudioDocument>();
  const [data, setData] = useState<Report | null>(null);
  const [reportError, setReportError] = useState(false);
  const [reportVersion, setReportVersion] = useState(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.studio);
  const reload = () => setReportVersion(version => version + 1);

  useEffect(() => {
    const update = () => setTab(tabFromHash());
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    function preserve(event: BeforeUnloadEvent) { event.preventDefault(); }
    window.addEventListener('beforeunload', preserve);
    return () => window.removeEventListener('beforeunload', preserve);
  }, [dirty]);

  useEffect(() => {
    if (tab !== 'chat' && tab !== 'stats') return;
    const abort = new AbortController();
    let pending = false;
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const response = await fetch('/api/admin/report', { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error();
        const report = await response.json() as Report;
        if (!abort.signal.aborted) { setData(report); setReportError(false); }
      } catch { if (!abort.signal.aborted) setReportError(true); }
      finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(load, 12000);
    document.addEventListener('visibilitychange', load);
    return () => { abort.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [tab, reportVersion]);

  function go(next: Tab) {
    window.history.pushState(null, '', next === 'settings' ? '/admin' : '#'+next);
    setTab(next);
    if (!error && next !== tab) setNotice('');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function update(patch: Partial<Edition>) {
    setDraft(previous => ({ ...previous, editions: { ...previous.editions, [phase]: { ...previous.editions[phase], ...patch } } }));
    setNotice('');
  }

  async function publish() {
    if (publishing || !dirty) return;
    setConflict(undefined);
    setNotice('');
    setError(false);
    const parsed = studioSchema.safeParse(draft);
    if (!parsed.success) {
      const item = parsed.error.issues[0];
      const problemPhase = item.path[0] === 'editions' ? item.path[1] as Phase : null;
      if (problemPhase) setPhase(problemPhase);
      const control = item.path[2];
      if (control === 'hero') setBlock('broadcast');
      else if (control === 'greetings') setBlock('chat');
      else if (control === 'circuitTitle') setBlock('circuit-chat');
      else if (control === 'activities' || control === 'television' || control === 'archive') setBlock(control);
      if (problemPhase) go('settings');
      if (item.path[0] === 'contacts') go('contacts');
      setError(true);
      setNotice((problemPhase ? phaseLabels[problemPhase] + ' · ' : '') + (item.message.startsWith('String') ? 'Заполните текстовые поля' : item.message));
      return;
    }
    setPublishing(true);
    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ studio: parsed.data, revision: saved.revision }),
      });
      const result = await response.json() as StudioDocument & { error?: string; current?: StudioDocument };
      if (!response.ok) {
        setConflict(result.current);
        throw new Error(result.error ?? 'Не удалось опубликовать изменения');
      }
      setSaved(result);
      setDraft(previous => previous === draft ? result.studio : previous);
      setNotice('Изменения опубликованы');
    } catch (reason) {
      setError(true);
      setNotice(reason instanceof Error && reason.message !== 'Failed to fetch' ? reason.message : 'Связь прервалась. Попробуйте ещё раз');
    } finally { setPublishing(false); }
  }

  return <div className="studio-shell">
    <aside className="studio-side">
      <a href="/admin" onClick={event => { event.preventDefault(); go('settings'); }} className="studio-logo">
        <img src="/visual/cdek-fm.svg" width="122" height="22" alt="СДЭК FM" />
        <span>Редакция</span>
      </a>
      <nav className="studio-nav" aria-label="Разделы редакции">
        {tabs.map(item => <button key={item.id} type="button" onClick={() => go(item.id)} aria-current={item.id === tab ? 'page' : undefined}>
          {item.icon === 'support' ? <Icon name="support" size={19} /> : <Glyph name={item.icon} />}
          <span>{item.text}</span>{item.id === tab && <Glyph name="arrow" size={15} />}
        </button>)}
      </nav>
      <div className="studio-side-foot"><span className="studio-avatar" aria-hidden="true">✓</span><span>{editorName}</span></div>
    </aside>
    <div className="studio-workspace">
      <header className="studio-top">
        <div className="studio-top-status"><span className="studio-top-dot" /><span>На сайте</span><strong>{phaseLabels[saved.studio.active]}</strong></div>
        <div className="studio-top-actions">
          <a className="studio-open" href="/" aria-label="Открыть сайт" target="_blank" rel="noopener noreferrer"><span>Открыть сайт</span><Glyph name="external" size={17} /></a>
          <form method="post" action="/api/admin/session">
            <input type="hidden" name="action" value="logout" />
            <button className="studio-open" type="submit" aria-label="Выйти" title="Выйти"><span>Выйти</span><Glyph name="logout" size={17} /></button>
          </form>
          <button className="studio-publish" type="button" onClick={() => void publish()} aria-busy={publishing} disabled={!dirty || publishing}>
            {publishing ? 'Публикуем…' : 'Опубликовать'}
          </button>
        </div>
      </header>
      <main className="studio-main">
        {notice && <div className={'studio-status-message ' + (error ? 'studio-error' : '')} role="status">{!error && <Glyph name="check" />}
          <span>{notice}</span>
          {conflict && <button className="studio-secondary" type="button" onClick={() => {
            setSaved(conflict); setDraft(conflict.studio); setPhase(conflict.studio.active); setConflict(undefined); setNotice('');
          }}>Загрузить опубликованное</button>}
        </div>}
        {tab === 'settings' && <SiteSettings phase={phase} setPhase={setPhase} draft={draft} published={saved.studio.active} update={update}
          activate={() => { setDraft(previous => ({ ...previous, active: phase })); setNotice(''); }} block={block} setBlock={setBlock} />}
        {tab === 'contacts' && <ContactSettings value={draft.contacts} change={patch => {
          setDraft(previous => ({ ...previous, contacts: { ...previous.contacts, ...patch } })); setNotice('');
        }} />}
        {tab === 'chat' && <Inbox data={data} error={reportError} reload={reload} />}
        {tab === 'support' && <SupportInbox />}
        {tab === 'stats' && <Stats data={data} error={reportError} reload={reload} />}
        {tab === 'metrics' && <Metrics value={draft.metrika} change={metrika => { setDraft(previous => ({ ...previous, metrika })); setNotice(''); }} />}
      </main>
    </div>
  </div>;
}
