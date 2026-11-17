'use client';

import { useEffect, useState } from 'react';
import { blockPresentation, dialHref, type Block, type Edition, type PublicEdition } from '../studio-config';
import { WallChat } from './wall-chat';
import { TrackOrder } from './track-order';
import { Metrika } from './metrika';
import { Archive, ContactLinks } from './interface';
import { GreetingProvider } from './greetings';
import { AirDock, FacecastScreen, OnAirProvider, WatchBroadcast } from './on-air';
import { LiveScene } from './live-scene';
import { returnId } from './scroll-route';
import './on-air.css';
import './chat.css';
import './desktop.css';
import { Icon } from './icons';

function BroadcastCopy({ edition, titleId }: { edition: Edition; titleId?: string }) {
  const hero = edition.hero;
  const title = <><span>{hero.title}</span>{' '}<em>{hero.accent}</em></>;
  return <div className="hero-copy">
    {titleId ? <h1 id={titleId} tabIndex={-1}>{title}</h1> : <p className="hero-title">{title}</p>}
    <p className="hero-description">{hero.description}</p>
    <div className="broadcast-meta">
      <span className="date"><Icon name="clock" size={20} />{hero.date}</span>
    </div>
  </div>;
}

export function Site({ initial, editorial }: { initial: PublicEdition; editorial: boolean }) {
  const [current, setCurrent] = useState(initial);
  useEffect(() => {
    const abort = new AbortController();
    let pending = false;
    async function update() {
      if (document.hidden || pending) return;
      pending = true;
      try {
        const result = await fetch('/api/site-settings', { cache: 'no-store', signal: abort.signal });
        if (!result.ok || abort.signal.aborted) return;
        const next: PublicEdition = await result.json();
        setCurrent(previous => next.revision > previous.revision ? next : previous);
      } catch { /* Keep the published edition while offline. */ }
      finally { pending = false; }
    }
    const timer = window.setInterval(update, 8000);
    document.addEventListener('visibilitychange', update);
    return () => {
      abort.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const { edition, contacts } = current;
  const telephone = contacts.phoneEnabled ? dialHref(contacts.phoneNumber) : '';
  const block = (id: Block) => {
    const presentation = blockPresentation(edition, id);
    return {
      id, 'data-route': '', 'data-art': presentation.visual,
      'data-suppressed': !presentation.visible || undefined,
      'aria-hidden': !presentation.visible || undefined,
      inert: !presentation.visible,
    };
  };
  const chatTarget = blockPresentation(edition, 'circuit-chat').visible ? 'circuit-chat' : undefined;
  const first = edition.blocks.activities.visible ? 'activities' : edition.blocks.television.visible ? 'television' :
    edition.blocks.archive.visible ? 'archive' : chatTarget ?? 'broadcast';
  const archive = (['december', 'february'] as const).map(cover => {
    const item = edition.archive[cover];
    const image = cover === 'december' ? '/visual/archive-december-20261116.jpg' : '/visual/archive-february-20261116.png';
    return { ...item, cover, image, source: item.embedded ? item.url : '', external: item.embedded ? undefined : item.url };
  });

  return (
    <GreetingProvider>
    <OnAirProvider radioSource={edition.radioUrl} videoSource={edition.tvUrl} radioEnabled={edition.radioEnabled}
      tvEnabled={edition.tvEnabled && edition.blocks.television.visible}>
      <LiveScene edition={edition} />
      <Metrika id={current.metrika} />
      <header className="site-header">
        <div className="header-content">
          <a href={edition.blocks.broadcast.visible ? "#broadcast" : "#" + first} className="brand" aria-label="СДЭК">
            <img src="/visual/cdek-mark.svg" alt="СДЭК" width="93" height="26" fetchPriority="high" />
          </a>
          <ContactLinks contacts={contacts} includePhone />
        </div>
      </header>
      <main className="air-content">
        <section {...block('broadcast')} className="hero" aria-labelledby="broadcast-title">
          <div className="hero-inner wrap">
            <BroadcastCopy edition={edition} titleId="broadcast-title" />
            <a className="scroll-cue" href={'#' + first} aria-label="Далее по трассе"><Icon name="down" size={21} /></a>
          </div>
        </section>
        <section {...block('activities')} className="activities" aria-label={edition.activities.watch}>
          <div className="activity-layout wrap">
            <ul className="activity-list">
              <li className="activity-row">
                <WatchBroadcast className="activity-content">
                  <span className="activity-icon"><Icon name="video" size={25} /></span>
                  <span>{edition.activities.watch} <span className="activity-detail">{edition.activities.when}</span></span>
                  <Icon name="upRight" size={19} />
                </WatchBroadcast>
              </li>
              {telephone && <li className="activity-row">
                <a className="activity-content" href={telephone}>
                  <span className="activity-icon"><Icon name="phone" size={23} /></span>
                  <span>{edition.activities.call} <span className="activity-detail">{contacts.phoneNumber}</span></span>
                  <Icon name="upRight" size={19} />
                </a>
              </li>}
              <li className="activity-row">
                <div className="activity-content activity-message">
                  <span className="activity-icon"><Icon name="send" size={23} /></span>
                  <p>{edition.activities.greetings}</p>
                  <ContactLinks contacts={contacts} showMessengerNumber />
                </div>
              </li>
            </ul>
          </div>
        </section>
        <section {...block('television')} className="television" aria-labelledby="television-title">
          <div className="television-layout wrap">
            <div className="television-copy">
              <h2 id="television-title">{edition.television.title} <em>{edition.television.accent}</em></h2>
            </div>
            <FacecastScreen />
          </div>
        </section>
        <section {...block('archive')} className="archive-section" aria-labelledby="archive-title">
          <div className="archive-layout wrap">
            <h2 id="archive-title">{edition.archive.title}</h2>
            <Archive entries={archive} />
          </div>
        </section>
        {edition.blocks.archive.visible && <div className="archive-departure" aria-hidden="true" />}
        <section {...block('circuit-chat')} className="circuit-chat" aria-labelledby="circuit-chat-title">
          <span id="chat" className="chat-anchor" aria-hidden="true" />
          <WallChat editorial={editorial} circuit title={edition.circuitTitle} />
          {edition.tracksEnabled && <div className="circuit-track wrap"><TrackOrder /></div>}
        </section>
      </main>
      <footer className="site-footer" data-route>
        <div className="footer-content wrap">
          {edition.tracksEnabled && !chatTarget && <TrackOrder />}
          <a className="brand" href="#broadcast" aria-label="СДЭК"><img src="/visual/cdek-mark.svg" alt="СДЭК" width="96" height="26" loading="lazy" /></a>
          <a className="footer-media" href="https://megapolis.media/" target="_blank" rel="noopener noreferrer"><img src="/visual/megapolis-media.webp" alt="Мегаполис Медиа" width="168" height="33" loading="lazy" /></a>
        </div>
      </footer>
      <div className="route-return" id={returnId}>
        <div className="route-return-copy hero-inner wrap" aria-hidden="true">{edition.blocks.broadcast.visible && <BroadcastCopy edition={edition} />}</div>
        <a href="#broadcast" className="route-return-link" aria-label="В начало">
          <Icon name="loop" size={27} />
        </a>
      </div>
      <AirDock chatTarget={chatTarget} />
    </OnAirProvider>
    </GreetingProvider>
  );
}
