'use client';

import { type FormEvent, type RefObject, useRef, useState } from 'react';
import { supportDescriptionLimit } from '../support-types';
import { Icon } from './icons';
import './support.css';

export function SupportButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  return <button type="button" className={compact ? 'air-support' : 'site-support-link'}
    aria-label="Техническая поддержка" aria-haspopup="dialog" aria-controls="technical-support" onClick={onClick}>
    <Icon name="support" size={18} /><span>{compact ? 'Поддержка' : 'Техническая поддержка'}</span>
  </button>;
}

export function SupportDialog({ dialogRef }: { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const submission = useRef<{ id: string; email: string; description: string } | null>(null);
  const [email, setEmail] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [number, setNumber] = useState<number | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !description.trim()) return;
    setBusy(true);
    setError('');
    try {
      const address = email.trim();
      const issue = description.trim();
      if (submission.current?.email !== address || submission.current.description !== issue) {
        submission.current = { id: crypto.randomUUID(), email: address, description: issue };
      }
      const response = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission.current),
      });
      const result = await response.json() as { number?: number; error?: string };
      if (!response.ok || typeof result.number !== 'number') {
        if (response.status === 409) submission.current = null;
        setError(result.error || 'Не удалось отправить заявку. Попробуйте ещё раз.');
        return;
      }
      submission.current = null;
      setEmail('');
      setDescription('');
      setNumber(result.number);
    } catch {
      setError('Не удалось отправить заявку. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <dialog ref={dialogRef} id="technical-support" className="site-support-dialog" aria-labelledby="support-title"
    onClose={() => setNumber(null)}>
    <header className="site-support-heading">
      <span className="site-support-mark"><Icon name="support" size={22} /></span>
      <h2 id="support-title">Техническая поддержка</h2>
      <button type="button" className="site-support-close" aria-label="Закрыть" onClick={() => dialogRef.current?.close()}>
        <Icon name="close" size={21} />
      </button>
    </header>
    {number === null ? <form className="site-support-form" onSubmit={event => void send(event)}>
      <label>Email для ответа
        <input type="email" name="email" autoComplete="email" maxLength={254} required value={email} readOnly={busy}
          onChange={event => setEmail(event.currentTarget.value)} />
      </label>
      <label>С чем нужна помощь
        <textarea name="description" rows={5} maxLength={supportDescriptionLimit} required value={description}
          readOnly={busy} onChange={event => setDescription(event.currentTarget.value)} />
      </label>
      {error && <p className="site-support-error" role="alert">{error}</p>}
      <button className="site-support-submit" type="submit" disabled={busy || !description.trim()}>
        {busy ? 'Отправляем…' : 'Отправить заявку'}
      </button>
    </form> : <div className="site-support-form" role="status">
      <p className="site-support-success"><Icon name="check" size={19} />Заявка №{number} принята</p>
      <button className="site-support-submit" type="button" onClick={() => dialogRef.current?.close()}>Готово</button>
    </div>}
  </dialog>;
}
