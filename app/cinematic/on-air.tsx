'use client';

import { createContext, type CSSProperties, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from './icons';
import { GreetingLink } from './greetings';
import { useRadio } from './use-radio';
import { metric } from './metrika';

type Mode = 'idle' | 'radio' | 'facecast' | 'archive';
type StopArchive = () => void;
const motionStorageKey = 'cdek-fm-3d-motion';

function useOnAirController(radioSource: string, videoSource: string, radioEnabled: boolean, tvEnabled: boolean) {
  const radio = useRadio(radioSource);
  const active = useRef<Mode>('idle');
  const archiveStop = useRef<StopArchive | null>(null);
  const previousSources = useRef({ radioSource, videoSource });
  const [mode, setMode] = useState<Mode>('idle');
  const [systemReduced, setSystemReduced] = useState(false);
  const [motionChoice, setMotionChoice] = useState<'on' | 'off' | null>(null);
  const [motionReady, setMotionReady] = useState(false);
  const motionPaused = motionChoice === null ? systemReduced : motionChoice === 'off';

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setSystemReduced(query.matches);
    sync();
    try {
      const stored = localStorage.getItem(motionStorageKey);
      if (stored === 'on' || stored === 'off') setMotionChoice(stored);
    } catch { /* Storage can be disabled. */ }
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.cdekMotion = motionPaused ? 'off' : 'on';
    return () => { delete root.dataset.cdekMotion; };
  }, [motionPaused]);

  function setMotionPaused(paused: boolean) {
    const choice = paused ? 'off' : 'on';
    setMotionChoice(choice);
    try { localStorage.setItem(motionStorageKey, choice); } catch { /* Keep the selection for this visit. */ }
  }

  function select(next: Mode) {
    active.current = next;
    setMode(next);
  }

  function releaseArchive() {
    const stop = archiveStop.current;
    archiveStop.current = null;
    stop?.();
  }

  function startRadio() {
    if (!radioEnabled) return;
    metric('radio_play');
    if (active.current === 'facecast' || active.current === 'archive') {
      // Remove the remote frame before playing audio in this same user gesture.
      flushSync(() => {
        releaseArchive();
        select('radio');
      });
    } else {
      select('radio');
    }
    radio.play();
  }

  function stopRadio() {
    radio.stop();
    if (active.current === 'radio') select('idle');
  }

  function closeFacecast() {
    if (active.current === 'facecast') select('idle');
  }

  function openFacecast() {
    if (!tvEnabled) return;
    if (active.current !== 'facecast') {
      metric('video_open');
      radio.stop();
      releaseArchive();
      select('facecast');
    }
    document.getElementById('television')?.scrollIntoView({ behavior: motionPaused ? 'instant' : 'smooth' });
  }

  function openArchive(stop: StopArchive) {
    radio.stop();
    releaseArchive();
    archiveStop.current = stop;
    if (active.current === 'facecast') flushSync(() => select('archive'));
    else select('archive');
  }

  function archiveClosed(stop: StopArchive) {
    if (archiveStop.current !== stop) return;
    archiveStop.current = null;
    if (active.current === 'archive') select('idle');
  }

  function leaveForArchive() {
    radio.stop();
    releaseArchive();
    select('idle');
  }

  useEffect(() => {
    if (active.current === 'radio' && (!radioEnabled || previousSources.current.radioSource !== radioSource)) stopRadio();
    if (active.current === 'facecast' && (!tvEnabled || previousSources.current.videoSource !== videoSource)) closeFacecast();
    previousSources.current = { radioSource, videoSource };
  }, [radioEnabled, tvEnabled, radioSource, videoSource]);

  return { radio, mode, videoSource, radioEnabled, tvEnabled, startRadio, stopRadio, openFacecast, closeFacecast, openArchive, archiveClosed,
    leaveForArchive, motionPaused, setMotionPaused, motionReady, setMotionReady };
}

type OnAir = ReturnType<typeof useOnAirController>;
const OnAirContext = createContext<OnAir | null>(null);

export function OnAirProvider({ radioSource, videoSource, radioEnabled, tvEnabled, children }: {
  radioSource: string; videoSource: string; radioEnabled: boolean; tvEnabled: boolean; children: ReactNode;
}) {
  const player = useOnAirController(radioSource, videoSource, radioEnabled, tvEnabled);
  return <OnAirContext.Provider value={player}>{children}</OnAirContext.Provider>;
}

export function useOptionalOnAir() { return useContext(OnAirContext); }

export function useOnAir() {
  const onAir = useOptionalOnAir();
  if (!onAir) throw new Error('CDEK FM player provider is missing');
  return onAir;
}

const barHeights = [17, 25, 36, 29, 39, 30, 20];

function ParcelMeter() {
  const { radio, motionPaused } = useOnAir();
  const meter = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!meter.current) return;
    const element = meter.current;
    const columns = Array.from(element.querySelectorAll<HTMLElement>('.air-meter-col'));
    let frame = 0;

    function rest() {
      columns.forEach(column => column.style.setProperty('--level', '.035'));
      element.style.removeProperty('--beat');
      element.dataset.signal = 'rest';
    }

    function update(now: number) {
      frame = requestAnimationFrame(update);
      const reading = radio.signal.read();
      const measured = reading.state === 'live' ? reading.frame : null;
      const breathing = reading.state === 'idle' || (reading.state === 'waiting' && !reading.atRest);
      const state = measured ? 'active' : breathing ? reading.state : 'rest';
      if (state === 'rest') {
        if (element.dataset.signal !== state) rest();
        return;
      }
      if (element.dataset.signal !== state) element.dataset.signal = state;
      element.style.setProperty('--beat', (measured?.beat ?? 0).toFixed(3));
      columns.forEach((column, i) => {
        const height = measured ? Math.min(1, .06 + measured.bands[i] * .85 + measured.beat * (i < 2 ? .17 : .08))
          : .17 + .08 * Math.sin(now * .0025 + i * .8);
        column.style.setProperty('--level', height.toFixed(3));
      });
    }

    function sync() {
      cancelAnimationFrame(frame);
      if (radio.signal.read().state !== 'parked' && !motionPaused && !document.hidden) {
        frame = requestAnimationFrame(update);
      } else rest();
    }
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [radio.status, radio.signal, motionPaused]);

  return <div className="air-meter" ref={meter} aria-hidden="true">
    {barHeights.map((height, i) => <span className="air-meter-col" key={i}
      style={{ '--height': height + 'px' } as CSSProperties}>
      <span className="air-meter-segments" /><span className="air-meter-box" />
    </span>)}
  </div>;
}

const radioMessages = {
  stopped: 'Зарядись на движение!',
  connecting: 'Подключаем радио…',
  playing: 'Радио играет',
  error: 'Радио недоступно. Нажмите Play для повтора.',
} as const;

export function AirDock({ chatTarget }: { chatTarget?: 'chat' | 'circuit-chat' }) {
  const { radio, mode, radioEnabled, tvEnabled, startRadio, stopRadio, openFacecast, closeFacecast,
    motionReady, motionPaused, setMotionPaused } = useOnAir();
  const isFacecast = tvEnabled && mode === 'facecast';
  const radioIsOn = mode === 'radio' && (radio.status === 'playing' || radio.status === 'connecting');
  const status = isFacecast ? 'Телерадиоэфир' : radioEnabled ? radioMessages[radio.status] : 'Радио вне эфира';

  return <aside className="air-dock" aria-label="Плеер CDEK FM" data-mode={mode} data-radio={radio.status}>
    <div className="air-identity">
      <img src="/visual/cdek-fm.svg" alt="CDEK FM" width="104" height="19" />
      <span className="air-radio-status" role="status" title={status}><i aria-hidden="true" />{status}</span>
    </div>
    <div className="air-controls">
      <button type="button" className="air-radio-toggle" data-active={radioIsOn}
        onClick={radioIsOn ? stopRadio : startRadio} disabled={!radioEnabled}
        aria-label={radioIsOn ? 'Stop — остановить радио' : 'Play — включить радио'}>
        <Icon name={radioIsOn ? 'stop' : 'play'} size={19} /><span>{radioIsOn ? 'Stop' : 'Play'}</span>
      </button>
      {chatTarget && <GreetingLink className="air-greeting" target={chatTarget} />}
      <button type="button" className="air-facecast" data-active={isFacecast} disabled={!tvEnabled}
        aria-controls="facecast-screen" onClick={isFacecast ? closeFacecast : openFacecast}>
        <Icon name={isFacecast ? 'close' : 'video'} size={19} />
        <span>{!tvEnabled ? 'Эфир выключен' : isFacecast ? 'Закрыть эфир' : 'Смотреть эфир'}</span>
      </button>
    </div>
    <div className="air-tools">
      <ParcelMeter />
      <div className="air-volume">
        <Icon name={radio.volume ? 'volume' : 'mute'} size={17} />
        <input type="range" min="0" max="100" disabled={!radioEnabled} aria-label="Громкость радио"
          value={Math.round(radio.volume * 100)} style={{ '--volume': Math.round(radio.volume * 100) + '%' } as CSSProperties}
          onChange={event => radio.changeVolume(Number(event.currentTarget.value) / 100)} />
      </div>
      {motionReady && <button className="air-motion" type="button" title={motionPaused ? 'Включить 3D-анимацию' : 'Приостановить 3D-анимацию'}
        aria-label="3D-анимация" aria-pressed={!motionPaused} onClick={() => setMotionPaused(!motionPaused)}>
        <Icon name={motionPaused ? 'play' : 'pause'} size={13} /><span>3D</span>
      </button>}
    </div>
  </aside>;
}

export function WatchBroadcast({ children, className }: { children: ReactNode; className?: string }) {
  const { openFacecast, tvEnabled } = useOnAir();
  return <button type="button" className={className} disabled={!tvEnabled} onClick={openFacecast}>{children}</button>;
}

export function FacecastScreen() {
  const { mode, videoSource, openFacecast, tvEnabled } = useOnAir();
  return <div id="facecast-screen" className="air-screen" data-playing={mode === 'facecast' && tvEnabled}>
    {tvEnabled && mode === 'facecast'
      ? <iframe src={videoSource} title="Телерадиоэфир СДЭК в Facecast" allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      : <button type="button" className="air-screen-start" onClick={openFacecast} disabled={!tvEnabled} aria-label="Смотреть эфир">
        <img className="air-screen-logo" src="/visual/cdek-fm.svg" alt="" width="104" height="19" />
        <span className="air-screen-play"><Icon name="play" size={30} /></span>
      </button>}
  </div>;
}
