'use client';

import { useEffect, useRef, useState } from 'react';

const variants = [
  {
    id: 'equalizer',
    label: 'Эквалайзер',
    beats: [
      ['Трасса', 'На высоких|скоростях!', 'Зелёная фура ведёт камеру по виражу. Коробки летят по своим световым полосам.'],
      ['Эквалайзер', 'Посылки|в такт', 'Полосы поднимаются, а коробки становятся пиками эквалайзера. Оранжевая посылка остаётся в кадре.'],
      ['Пульт', 'От пиков|к фейдерам', 'Камера наклоняется к пульту. Те же полосы ложатся в каналы, а коробки садятся на направляющие.'],
      ['Эфир', 'Телерадио|эфир', 'Оранжевая посылка проходит над пультом и становится индикатором на раме эфирного монитора.'],
    ],
  },
  {
    id: 'mixer',
    label: 'Пульт',
    beats: [
      ['Трасса', 'На высоких|скоростях!', 'Камера снижается вслед за фурой к посылкам на скоростных полосах.'],
      ['Пульт', 'Вираж|в каналы', 'Вид сверху выпрямляет полосы трассы в каналы пульта. Посылки остаются в своих рядах и становятся фейдерами.'],
      ['Уровни', 'Фейдеры|задают ритм', 'Камера поднимается над пультом. Световые шкалы встают вертикально и отрабатывают движения фейдеров.'],
      ['Эфир', 'Телерадио|эфир', 'Шкалы расходятся к краям монитора. Оранжевый фейдер переходит в индикатор эфирного сигнала.'],
    ],
  },
  {
    id: 'tele',
    label: 'Телерадио',
    beats: [
      ['Трасса', 'На высоких|скоростях!', 'Камера выбирает оранжевую коробку и подходит к ней вслед за фурой.'],
      ['Посылка', 'Коробка|в кадре', 'Посылка поворачивается лицом к камере. Световые полосы сходятся к её кромкам.'],
      ['Камера', 'Из коробки|в экран', 'Крышка раскрывается. Передняя грань растёт в рамку монитора, а ленты расходятся к камере и пульту.'],
      ['Эфир', 'Телерадио|эфир', 'В кадре собирается режиссёрская. Контур посылки остаётся в раме монитора.'],
    ],
  },
] as const;

const sceneIcons = {
  equalizer: 'M3 14v-4m4 8V6m5 15V3m5 15V6m4 8v-4',
  mixer: 'M5 3v8m0 4v6m7-18v3m0 4v11m7-18v11m0 4v3M2 11h6v4H2zm7-5h6v4H9zm7 8h6v4h-6z',
  tele: 'M3 6h18v12H3zm5 15h8m-4-3v3m-2-12 5 3-5 3z',
  play: 'm9 5 11 7-11 7z',
  pause: 'M9 5v14m6-14v14',
  arrow: 'M6 18 18 6m-9 0h9v9',
  reset: 'M4.4 11a7.7 7.7 0 1 1 2.4 6.4M4 5v6h6',
} as const;

function Glyph({ name }: { name: keyof typeof sceneIcons }) {
  return <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
    <path d={sceneIcons[name]} fill={name === 'play' ? 'currentColor' : 'none'} />
  </svg>;
}

const runTime = 13200;
const lastBeat = 3;
const clamp = (value: number, min = 0, max = lastBeat) => Math.max(min, Math.min(max, value));

export function MotionStudy() {
  const journey = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const monitor = useRef<HTMLVideoElement>(null);
  const scrub = useRef<HTMLInputElement>(null);
  const playback = useRef(0);
  const selection = useRef(0);
  const position = useRef(0);
  const start = useRef(0);
  const scrollLength = useRef(1);
  const [variant, setVariant] = useState(0);
  const [beat, setBeat] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [showArtwork, setShowArtwork] = useState(false);
  const active = variants[variant];
  const [first, second] = active.beats[beat][1].split('|');

  function jump(value: number, behavior: ScrollBehavior = 'instant') {
    window.scrollTo({ top: start.current + clamp(value) / lastBeat * scrollLength.current, behavior });
  }

  function stop() {
    if (!playback.current) return;
    cancelAnimationFrame(playback.current);
    playback.current = 0;
    setPlaying(false);
  }

  function play() {
    if (playback.current) {
      stop();
      return;
    }
    const initial = position.current >= 2.98 ? 0 : position.current;
    const started = performance.now() - initial / lastBeat * runTime;
    setPlaying(true);
    function tick(now: number) {
      const value = clamp((now - started) / runTime * lastBeat);
      jump(value);
      if (value >= lastBeat) {
        playback.current = 0;
        setPlaying(false);
      } else {
        playback.current = requestAnimationFrame(tick);
      }
    }
    playback.current = requestAnimationFrame(tick);
  }

  function select(i: number) {
    selection.current = i;
    setVariant(i);
    const url = new URL(window.location.href);
    url.searchParams.set('variant', variants[i].id);
    history.replaceState(history.state, '', url);
  }

  useEffect(() => {
    const area = journey.current;
    const panel = screen.current;
    const target = canvas.current;
    if (!area || !panel || !target) return;
    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)');
    const id = new URLSearchParams(location.search).get('variant');
    const preset = variants.findIndex(item => item.id === id);
    if (preset >= 0) {
      selection.current = preset;
      setVariant(preset);
    }
    let closed = false;
    let dispose: undefined | (() => void);
    let previousBeat = -1;
    let previousEnd = false;

    function readScroll() {
      const value = clamp((window.scrollY - start.current) / scrollLength.current * lastBeat);
      position.current = value;
      const frame = Math.round(value);
      const end = value >= 2.98;
      if (frame !== previousBeat) {
        previousBeat = frame;
        setBeat(frame);
      }
      if (end !== previousEnd) {
        previousEnd = end;
        setAtEnd(end);
      }
      if (scrub.current) scrub.current.value = String(Math.round(value * 50) * 20);
      panel?.style.setProperty('--motion-progress', (value / lastBeat * 100) + '%');
    }

    function measure() {
      if (!area || !panel) return;
      start.current = area.getBoundingClientRect().top + window.scrollY;
      scrollLength.current = Math.max(1, area.offsetHeight - panel.offsetHeight);
      readScroll();
    }

    function stopOnKey(event: KeyboardEvent) {
      if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) stop();
    }

    const observer = new ResizeObserver(measure);
    observer.observe(area);
    observer.observe(panel);
    window.addEventListener('scroll', readScroll, { passive: true });
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchstart', stop, { passive: true });
    window.addEventListener('keydown', stopOnKey);
    measure();

    void import('./artwork.js').then(({ mountArtwork }) => {
      if (closed) return;
      dispose = mountArtwork(target, {
        progress: () => position.current,
        variant: () => selection.current,
        reduced: () => prefersReduced.matches,
        monitor: monitor.current,
        live: false,
        levels: () => null,
        ready: () => { if (!closed) setShowArtwork(true); },
      });
    }).catch(() => { if (!closed) setShowArtwork(false); });

    return () => {
      closed = true;
      observer.disconnect();
      window.removeEventListener('scroll', readScroll);
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchstart', stop);
      window.removeEventListener('keydown', stopOnKey);
      cancelAnimationFrame(playback.current);
      dispose?.();
    };
  }, []);

  return (
    <main className="motion-study">
      <div className="motion-journey" ref={journey}>
        <div className="motion-screen" ref={screen} data-variant={active.id} data-beat={beat}>
          <div className={'motion-stage' + (showArtwork ? ' is-rendered' : '')} aria-hidden="true">
            <div className="motion-cover" />
            <canvas className="motion-canvas" ref={canvas} />
            <video ref={monitor} className="motion-monitor-source" muted loop playsInline preload="none" tabIndex={-1} />
            <div className="motion-shade" />
          </div>
          <header className="motion-header">
            <a className="motion-logo" href="/" aria-label="CDEK FM">
              <img src="/visual/cdek-fm.svg" alt="CDEK FM" width="104" height="19" />
            </a>
            <span className="motion-review">Арт-дирекшн</span>
            <div className="motion-variants" role="group" aria-label="Вариант 3D-переходов">
              {variants.map((item, i) =>
                <button type="button" key={item.id} aria-pressed={i === variant} onClick={() => select(i)}>
                  <Glyph name={item.id} /><span>{item.label}</span>
                </button>)}
            </div>
            <a className="motion-back" href="/">Лендинг <Glyph name="arrow" /></a>
          </header>
          <div className="motion-copy" key={active.id + beat}>
            <h1>{first}<br /><em>{second}</em></h1>
            <p>{active.beats[beat][2]}</p>
          </div>
          <div className="motion-bottom">
            <button className="motion-play" type="button" onClick={play} aria-pressed={playing}
              aria-label={playing ? 'Пауза' : atEnd ? 'Повторить проезд' : 'Смотреть проезд'}>
              <Glyph name={playing ? 'pause' : atEnd ? 'reset' : 'play'} />
              <span>{playing ? 'Пауза' : atEnd ? 'Повторить' : 'Смотреть проезд'}</span>
            </button>
            <div className="motion-timeline">
              <input className="motion-scrub" ref={scrub} aria-label="Положение камеры"
                aria-valuetext={active.beats[beat][0]} type="range" min="0" max="3000" step="20" defaultValue="0"
                onPointerDown={stop} onChange={event => { stop(); jump(Number(event.currentTarget.value) / 1000); }} />
              <div className="motion-stops">
                {active.beats.map(([label], i) => <button key={i} type="button" aria-current={i === beat ? 'step' : undefined}
                  onClick={() => { stop(); jump(i, matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'); }}>
                  {label}
                </button>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
