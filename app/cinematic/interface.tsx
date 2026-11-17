'use client';

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import NextImage from 'next/image';
import { Icon } from './icons';
import { useOnAir } from './on-air';
import { dialHref, type Contacts } from '../studio-config';
import './archive-parcel.css';

function MaxContact({ url, phone }: { url: string; phone: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const number = useRef<HTMLInputElement>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'selected'>('idle');
  const icon = <NextImage unoptimized loading="eager" src="/visual/max.webp" width="22" height="22" alt="" />;

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(dialHref(phone).slice(4));
      setCopyStatus('copied');
    } catch {
      number.current?.focus();
      number.current?.select();
      setCopyStatus('selected');
    }
  }

  if (url) return <a className="contact-link" href={url} target="_blank" rel="noopener noreferrer" aria-label="МАКС" title="МАКС">{icon}</a>;

  return <>
    <button type="button" className="contact-link" aria-label="МАКС" aria-haspopup="dialog" title="МАКС"
      onClick={() => { setCopyStatus('idle'); dialog.current?.showModal(); }}>{icon}</button>
    <dialog ref={dialog} className="max-contact-dialog" aria-label="Найти редакцию в MAX">
      <form method="dialog" className="max-contact-heading">
        <h2>Найти редакцию в MAX</h2>
        <button type="submit" className="contact-link" aria-label="Закрыть"><Icon name="close" size={19} /></button>
      </form>
      <p>В поиске MAX вставьте номер и выберите «Найти по номеру».</p>
      <div className="max-contact-number">
        <input ref={number} value={phone} aria-label="Номер редакции" readOnly />
        <button type="button" className="max-contact-action max-contact-copy" aria-label="Копировать номер" title="Копировать номер"
          onClick={() => void copyNumber()}><Icon name={copyStatus === 'copied' ? 'check' : 'copy'} size={20} /></button>
      </div>
      {copyStatus !== 'idle' && <p role="status">{copyStatus === 'copied' ? 'Номер скопирован' : 'Скопируйте выделенный номер'}</p>}
      <a className="max-contact-action max-contact-open" href="https://web.max.ru/" target="_blank" rel="noopener noreferrer">Открыть MAX</a>
    </dialog>
  </>;
}

export function ContactLinks({ contacts, includePhone, showMessengerNumber }: {
  contacts: Contacts;
  includePhone?: boolean;
  showMessengerNumber?: boolean;
}) {
  const phone = includePhone && contacts.phoneEnabled ? dialHref(contacts.phoneNumber) : '';
  const messengerPhone = dialHref(contacts.messengerNumber).slice(4).replace(/^\+/, '');
  const telegram = contacts.telegramEnabled ? contacts.telegramUrl || 'https://t.me/+' + messengerPhone : '';
  const numberLink = telegram || (contacts.maxEnabled ? contacts.maxUrl : '');
  if (!phone && !telegram && !contacts.maxEnabled) return null;
  return <div className="contact-panel" role="group" aria-label={includePhone ? 'Контакты' : 'Мессенджеры'}>
    {phone && <a className="contact-link contact-phone" href={phone} aria-label={`Позвонить в эфир по номеру ${contacts.phoneNumber}`}>
      <Icon name="phone" size={19} />
      <span>{contacts.phoneNumber}</span>
    </a>}
    {telegram && <a className="contact-link" href={telegram} target="_blank" rel="noopener noreferrer"
      aria-label="Telegram" title="Telegram">
        <NextImage unoptimized loading="eager" src="/visual/telegram.svg" width="22" height="22" alt="" />
    </a>}
    {contacts.maxEnabled && <MaxContact url={contacts.maxUrl} phone={contacts.messengerNumber} />}
    {showMessengerNumber && contacts.messengerNumber && (numberLink
      ? <a className="contact-link contact-number" href={numberLink} target="_blank" rel="noopener noreferrer"
        aria-label={`Написать редакции, ${contacts.messengerNumber}`}>{contacts.messengerNumber}</a>
      : <span className="contact-number contact-number-static">{contacts.messengerNumber}</span>)}
  </div>;
}

function Player({ source, label }: { source: string; label: string }) {
  const player = useRef<HTMLVideoElement>(null);
  const url = new URL(source);
  const isHls = url.pathname.toLowerCase().endsWith('.m3u8');
  const native = isHls || /\.(mp4|webm|ogg|mov)$/i.test(url.pathname);

  useEffect(() => {
    const video = player.current;
    if (!video || !isHls || video.canPlayType('application/vnd.apple.mpegurl')) return;
    let detach: undefined | (() => void);
    let cancelled = false;
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) return;
      const hls = new Hls({ enableWorker: true });
      detach = () => hls.destroy();
      hls.attachMedia(video);
      hls.loadSource(source);
    }).catch(() => {});
    return () => { cancelled = true; detach?.(); };
  }, [source, isHls]);

  return native ? <video ref={player} src={source} controls playsInline autoPlay preload="metadata" />
    : <iframe src={source} title={label} allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
}

function MediaDialog({ source, label, children, className }: { source: string; label: string; children: ReactNode; className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { openArchive, archiveClosed } = useOnAir();
  const dismiss = useCallback(() => {
    dialog.current?.close();
    setOpen(false);
  }, []);

  function show() {
    openArchive(dismiss);
    dialog.current?.showModal();
    setOpen(true);
  }

  return (
    <>
      <button type="button" className={className} aria-label={label} onClick={show}>{children}</button>
      <dialog ref={dialog} className="player-dialog" aria-label={label} onClose={() => { setOpen(false); archiveClosed(dismiss); }}
        onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
        {open && <div className="player-content">
          <button type="button" className="close-player" aria-label="Закрыть" onClick={() => dialog.current?.close()}><Icon name="close" /></button>
          <Player source={source} label={label} />
        </div>}
      </dialog>
    </>
  );
}

type ArchiveEntry = { image: string; title: string; date: string; source: string; cover: string; external?: string };

function ArchiveParcel({ entry }: { entry: ArchiveEntry }) {
  const [opened, setRevealed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const replay = useRef<(() => void) | null>(null);
  const { leaveForArchive, motionPaused } = useOnAir();
  const revealed = motionPaused || opened;
  const screenId = 'archive-recording-' + entry.cover;
  const cover = <span className="archive-art"><NextImage unoptimized src={entry.image} width="960" height="540" alt="" loading="lazy" /></span>;

  useEffect(() => {
    const target = canvas.current;
    if (motionPaused || !target) return;
    let closed = false;
    let dispose: (() => void) | undefined;
    void import('../motion/artwork.js').then(({ mountArchiveParcel }) => {
      if (closed) return;
      const animation = mountArchiveParcel(target, entry.image, (value: boolean) => { if (!closed) setRevealed(value); });
      replay.current = animation.replay;
      dispose = animation.dispose;
    }).catch(() => { if (!closed) setRevealed(true); });
    return () => { closed = true; replay.current = null; dispose?.(); };
  }, [entry.image, motionPaused]);

  return <article className="archive-card" data-revealed={revealed}>
    <div className="archive-parcel">
      <canvas ref={canvas} className="archive-carton-canvas" aria-hidden="true" />
      <div className="parcel-screen" id={screenId} inert={!revealed} aria-hidden={!revealed}>
        {entry.source ? <MediaDialog source={entry.source} label={'Смотреть запись: ' + entry.title} className={'archive-cover ' + entry.cover}>
          {cover}<span className="archive-watchbar"><span>Смотреть запись</span><Icon name="play" size={20} /></span>
        </MediaDialog> : entry.external ? <a className={'archive-cover ' + entry.cover} href={entry.external} target="_blank" rel="noopener noreferrer" aria-label={'Открыть запись: ' + entry.title} onClick={leaveForArchive}>
          {cover}<span className="archive-watchbar"><span>Открыть запись</span><Icon name="upRight" size={20} /></span>
        </a> : <div className={'archive-cover ' + entry.cover}>{cover}</div>}
      </div>
      {!revealed && <button type="button" className="archive-open" aria-controls={screenId}
        aria-label={'Раскрыть архив: ' + entry.title} onClick={() => replay.current?.()}>
        <span><Icon name="parcel" size={17} />Раскрыть архив</span>
      </button>}
    </div>
    <div className="archive-caption"><h3>{entry.title}</h3><p>{entry.date}</p></div>
    {!motionPaused && <button type="button" className="archive-replay" aria-controls={screenId}
      aria-label={'Повторить раскрытие: ' + entry.title} onClick={() => replay.current?.()}>
      <Icon name="loop" size={17} />Повторить раскрытие
    </button>}
  </article>;
}

export function Archive({ entries }: { entries: ArchiveEntry[] }) {
  return <div className="archive-grid">{entries.map(entry => <ArchiveParcel entry={entry} key={entry.cover} />)}</div>;
}
