'use client';

import { type FormEvent, useRef, useState } from 'react';
import { chatClient, getNickname } from '../chat-types';
import { metric } from './metrika';

export function TrackOrder() {
  const dialog = useRef<HTMLDialogElement>(null);
  const retry = useRef<{ key: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || sent) return;
    const fields = new FormData(event.currentTarget);
    const title = String(fields.get('song') ?? '').trim();
    const artist = String(fields.get('artist') ?? '').trim();
    if (!title) { setFeedback('Укажите название песни'); return; }
    const key = title + '\n' + artist;
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    setBusy(true);
    setFeedback('');
    try {
      const response = await fetch('/api/track-requests', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: retry.current.id, client: chatClient(), title, artist, authorName: getNickname() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Попробуйте ещё раз');
      if (response.status === 201) metric('track_request');
      setSent(true);
      retry.current = null;
      setFeedback('Заявка передана редакции');
    } catch (error) {
      setFeedback(error instanceof Error && error.message !== 'Failed to fetch' ? error.message : 'Попробуйте ещё раз');
    } finally { setBusy(false); }
  }

  return <>
    <button type="button" className="track-open" onClick={() => {
      if (sent) { setSent(false); setFeedback(''); dialog.current?.querySelector('form')?.reset(); }
      dialog.current?.showModal();
    }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 18V5l10-2v13M10 9l10-2"/><ellipse cx="7" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>
    </svg>Заказать песню</button>
    <dialog className="track-dialog" ref={dialog} aria-label="Заказать песню">
      <form onSubmit={submit}>
        <div className="track-heading"><h2>Заказать песню</h2><button className="track-close" type="button" aria-label="Закрыть" onClick={() => dialog.current?.close()}>×</button></div>
        <label>Название песни<input name="song" placeholder="Название" maxLength={120} disabled={busy || sent} required autoFocus /></label>
        <label>Исполнитель <span>необязательно</span><input name="artist" placeholder="Имя исполнителя" maxLength={120} disabled={busy || sent} /></label>
        {feedback && <p role="status">{feedback}</p>}
        {sent ? <button type="button" className="track-submit" onClick={() => dialog.current?.close()}>Готово</button>
          : <button type="submit" className="track-submit" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить заявку'}</button>}
      </form>
    </dialog>
  </>;
}
