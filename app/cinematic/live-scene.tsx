'use client';

import { useEffect, useRef, useState } from 'react';
import { blockPresentation, type Edition } from '../studio-config';
import { mountArtwork } from '../motion/artwork.js';
import { useGreetings } from './greetings';
import { useOnAir } from './on-air';
import { chapterAt, chapters, clamp, cycleChapter, cycleLength, easeBetween, returnId, sceneAt, wrapScroll } from './scroll-route';

const filters = ['hero', 'activity', 'television', 'archive', 'chat'];
const loopExclusions = '.chat-list, .track-dialog, .player-dialog, iframe, input, select, textarea, [contenteditable]';
type ParcelPreview = { id: string; body: string; imageUrl?: string | null; x: number; y: number; appear: number; fold: number; fly: number; arrive: number };

function scrollsSeparately(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(loopExclusions));
}

export function LiveScene({ edition }: { edition: Edition }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dispatch = useRef<HTMLCanvasElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const { radio, motionPaused, setMotionReady } = useOnAir();
  const paused = useRef(motionPaused);
  const motionChanged = useRef<(() => void) | null>(null);
  const { departures, feed, chosen, enterLap } = useGreetings();
  const signal = radio.signal;
  const [active, setActive] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    paused.current = motionPaused;
    motionChanged.current?.();
  }, [motionPaused]);

  useEffect(() => {
    const element = stage.current;
    const target = canvas.current;
    if (!element || !target) return;
    const sections = chapters.map(([id]) => document.getElementById(id));
    const header = document.querySelector<HTMLElement>('.site-header');
    const screen = document.getElementById('facecast-screen');
    const archive = document.getElementById('archive');
    const archiveCards = archive?.querySelector<HTMLElement>('.archive-grid');
    const returning = document.getElementById(returnId);
    const circuit = document.querySelector<HTMLElement>('.circuit-visual');
    const targets = circuit?.querySelector<HTMLElement>('.circuit-taps');
    const preview = circuit?.querySelector<HTMLElement>('.circuit-preview');
    const ticket = preview?.querySelector<HTMLElement>('.circuit-preview-ticket');
    const ticketText = ticket?.querySelector<HTMLElement>('span');
    const ticketImage = ticket?.querySelector<HTMLImageElement>('img');
    const leader = preview?.querySelector<HTMLElement>('.circuit-preview-leader');
    const stamp = preview?.querySelector<HTMLElement>('.circuit-preview-stamp');
    const dock = document.querySelector<HTMLElement>('.air-dock');
    const pickTargets = new Map<string, HTMLSpanElement>();
    let marks: number[] = [];
    let archiveDeparture = 3.75;
    const routeScene = (chapter: number) => sceneAt(chapter, archiveDeparture);
    let position = 0;
    let requested = 0;
    let lastChapter = -1;
    let lastPresented = -1;
    let screenLayout: DOMRect | undefined;
    let circuitLayout: DOMRect | undefined;
    let circuitRect: DOMRect | null = null;
    let headerHeight = 0;
    let dockTop = 0;
    let previewMessage = '';
    let intensity = -1;
    let ticketWidth = 0, ticketHeight = 0;
    let turn = 0;
    let atEnd = false;
    let touch: { id: number; x: number; y: number; lastY: number; edge: number; blocked: number; manual: boolean } | null = null;
    let dispose: undefined | (() => void);

    function pageBounds(node: HTMLElement | null) {
      const box = node?.getBoundingClientRect();
      return box && new DOMRect(box.left, box.top + window.scrollY, box.width, box.height);
    }

    function atViewport(box: DOMRect | undefined) {
      return box && new DOMRect(box.x, box.y - window.scrollY, box.width, box.height);
    }

    function projectParcels(parcels: { id: string; x: number; y: number; size: number }[]) {
      if (!circuit || !targets || (!parcels.length && !pickTargets.size)) return;
      const box = circuitRect;
      if (!box) return;
      const seen = new Set<string>();
      parcels.forEach(parcel => {
        if (parcel.x < box.left || parcel.x > box.right || parcel.y < box.top || parcel.y > box.bottom) return;
        seen.add(parcel.id);
        let target = pickTargets.get(parcel.id);
        if (!target) {
          target = document.createElement('span');
          target.dataset.parcel = parcel.id;
          targets.appendChild(target);
          pickTargets.set(parcel.id, target);
        }
        target.style.transform = `translate(${parcel.x - box.left}px, ${parcel.y - box.top}px) translate(-50%, -50%)`;
        target.style.zIndex = String(Math.round(parcel.size));
      });
      for (const [id, target] of pickTargets) {
        if (seen.has(id)) continue;
        target.remove();
        pickTargets.delete(id);
      }
    }

    function presentGreeting(frame: ParcelPreview | null) {
      if (!preview || !ticket || !ticketText || !leader || !stamp) return;
      const box = circuitRect;
      const available = frame && box && frame.x >= box.left - 9 && frame.x <= box.right + 9
        && frame.y >= Math.max(box.top, headerHeight) - 26 && frame.y < Math.min(box.bottom + 27, dockTop)
        && box.bottom > headerHeight + 124 && dockTop - Math.max(box.top, headerHeight) > 116;
      if (!available) {
        if (!preview.hidden) preview.hidden = true;
        return;
      }
      if (preview.hidden || previewMessage !== frame.id) {
        preview.hidden = false;
        previewMessage = frame.id;
        ticketText.textContent = frame.body;
        if (ticketImage) {
          ticketImage.hidden = !frame.imageUrl;
          if (frame.imageUrl) ticketImage.src = frame.imageUrl;
          else ticketImage.removeAttribute('src');
        }
        ticketWidth = ticket.offsetWidth;
        ticketHeight = ticket.offsetHeight;
      }
      const half = ticketWidth / 2;
      const x = Math.max(half + 8, Math.min(box.width - half - 8, (frame.x - box.left) * .65 + box.width * .175));
      const y = Math.max(6, headerHeight - box.top + 8);
      const anchorX = frame.x - box.left;
      const anchorY = frame.y - box.top;
      const travelX = x + (anchorX - x) * frame.fly;
      const originY = y + ticketHeight * .55;
      const travelY = originY + (anchorY - originY) * frame.fly - 12 * Math.sin(Math.PI * frame.fly);
      const dx = anchorX - x, dy = anchorY - (y + ticketHeight);
      ticket.style.transform = `translate3d(${x - half}px,${y}px,0) scale(${1 - frame.fold * .14},${1 - frame.fold * .33})`;
      ticket.style.opacity = String(frame.appear * (1 - frame.fold));
      ticket.dataset.phase = frame.fly ? 'dispatch' : frame.fold ? 'fold' : 'read';
      leader.style.transform = `translate3d(${x}px,${y + ticketHeight - 1}px,0) rotate(${Math.atan2(dy, dx)}rad) scaleX(${Math.hypot(dx, dy)})`;
      leader.style.opacity = String(frame.appear * (1 - frame.fold) * .8 * clamp(dy / 32));
      stamp.style.transform = `translate3d(${travelX - 9}px,${travelY - 9}px,0) scale(${1 - frame.arrive * .72}) rotate(${frame.fly * 88}deg)`;
      stamp.style.opacity = String(frame.fold * (1 - frame.arrive));
    }

    function present(chapter: number, shot: number) {
      const screenRect = shot > 3.70 && shot < 4.57 ? atViewport(screenLayout) : undefined;
      circuitRect = shot > 6.72 && shot < 7.89 ? atViewport(circuitLayout) ?? null : null;
      let circuitCenter = null;
      if (circuitRect) {
        if (window.innerWidth > 1000) {
          const top = Math.max(circuitRect.top, headerHeight);
          const bottom = Math.min(circuitRect.bottom, dockTop);
          circuitCenter = bottom > top ? (top + bottom) * .5 : circuitRect.top + circuitRect.height * .5;
        } else circuitCenter = circuitRect.top + circuitRect.height * (window.innerWidth <= 720 ? .52 : .57);
      }
      const readyForPlayer = shot >= 3.945 && shot <= 4.243;
      const artAt = (index: number) => {
        const art = sections[index % cycleLength]?.dataset.art;
        return art === 'clean' ? 0 : art === 'soft' ? .42 : 1;
      };
      const index = Math.floor(chapter);
      const mix = easeBetween(.13, .85, chapter - index);
      const sceneIntensity = Math.round((artAt(index) * (1 - mix) + artAt(index + 1) * mix) * 1000) / 1000;
      if (intensity !== sceneIntensity) {
        intensity = sceneIntensity;
        element?.style.setProperty('--scene-intensity', String(intensity));
      }
      if (chapter !== lastPresented) {
        lastPresented = chapter;
        const currentChapter = chapter > cycleLength - .24 ? 0 : Math.min(cycleLength - 1, Math.round(chapter));
        if (currentChapter !== lastChapter) {
          setActive(currentChapter);
          lastChapter = currentChapter;
        }
        filters.forEach((name, i) => {
          const weight = (1 - easeBetween(0, 1, Math.abs(chapter - i)))
            * (i === 1 ? easeBetween(.52, 1, shot) : 1)
            * (i === 2 ? 1 - .83 * easeBetween(3.73, 3.93, shot) * (1 - easeBetween(4.23, 4.65, shot)) : 1)
            * (name === 'archive' ? 1 - easeBetween(5.88, 6.56, shot) : 1);
          const arrival = i === 0 ? easeBetween(7.63, 8, shot) : 0;
          element?.style.setProperty('--' + name + '-weight', Math.max(weight, arrival).toFixed(3));
        });
        navigation.current?.style.setProperty('--route-progress', `${(chapter / cycleLength * 100).toFixed(2)}%`);
        if (screen) {
          const revealed = String(readyForPlayer);
          if (screen.dataset.revealed !== revealed) screen.dataset.revealed = revealed;
          screen.style.setProperty('--screen-controls', String(easeBetween(3.945, 3.993, shot)));
        }
      }
      return screenRect && screen
        ? { box: screenRect, entry: Number(readyForPlayer || screen.dataset.playing === 'true' || screen.matches(':focus-within') || paused.current) }
        : { circuitCenter, circuitBounds: circuitRect };
    }

    function update() {
      requested = 0;
      const native = chapterAt(window.scrollY, marks);
      atEnd = native === cycleLength;
      position = paused.current ? Math.min(cycleLength - 1, Math.round(native)) : native + turn * cycleLength;
      if (!dispose) {
        const chapter = cycleChapter(position, atEnd);
        present(chapter, routeScene(chapter));
      }
    }

    function queue() {
      if (!requested) requested = requestAnimationFrame(update);
    }

    function measure() {
      const end = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const inset = header?.getBoundingClientRect().height ?? 0;
      headerHeight = inset;
      dockTop = dock?.getBoundingClientRect().top ?? window.innerHeight;
      if (preview) preview.hidden = true;
      circuitLayout = circuit?.closest('[data-suppressed=true]') ? undefined : pageBounds(circuit ?? null);
      screenLayout = screen?.closest('[data-suppressed=true]') ? undefined : pageBounds(screen);
      marks = sections.map((section, i) => {
        if (!section || i === 0) return 0;
        const top = section.getBoundingClientRect().top + window.scrollY - inset;
        return Math.min(end, Math.max(0, top));
      });
      marks.push(end);
      if (archiveCards && archive?.dataset.suppressed !== 'true') {
        const cleared = archiveCards.getBoundingClientRect().bottom + window.scrollY - inset + 16;
        const span = Math.max(1, marks[4] - marks[3]);
        archiveDeparture = 3 + clamp((cleared - marks[3]) / span);
        // The following transition space normally guarantees this room. Keep
        // the interpolation defined even in an unusually short custom layout.
        archiveDeparture = Math.min(3.99, archiveDeparture);
      } else archiveDeparture = 3;
      queue();
    }

    function enabled() {
      return Boolean(dispose) && !paused.current;
    }

    function pan(delta: number, manual = false) {
      const end = marks.at(-1) ?? 0;
      if (end <= window.innerHeight) return false;
      const top = Math.max(0, Math.min(end, window.scrollY));
      const next = top + delta;
      if (!manual && next <= end && next >= 0) return false;
      const wrapped = wrapScroll(next, end);
      turn += wrapped.turns;
      if (wrapped.turns) enterLap(turn);
      window.scrollTo({ top: wrapped.top, behavior: 'instant' });
      cancelAnimationFrame(requested);
      update();
      return true;
    }

    function continueRoute(event: WheelEvent) {
      if (!enabled() || event.ctrlKey || event.metaKey
        || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || event.deltaY === 0) return;
      if (scrollsSeparately(event.target) || !event.cancelable) return;
      // Pixel deltas already match native scroll. Let line and page deltas reach
      // the edge natively because their step size depends on the browser and OS.
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? window.innerHeight : 1;
      const end = marks.at(-1) ?? 0;
      const edge = event.deltaY > 0 ? window.scrollY >= end - 1 : window.scrollY <= 1;
      if ((event.deltaMode === 0 || edge) && pan(event.deltaY * unit)) event.preventDefault();
    }

    function continueKeys(event: KeyboardEvent) {
      if (!enabled() || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || scrollsSeparately(event.target)) return;
      if (event.target instanceof Element && event.target.closest('a, button, [role="button"]')) return;
      const page = window.innerHeight * .87;
      const distances: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: page, PageUp: -page, ' ': event.shiftKey ? -page : page };
      const delta = distances[event.key];
      if (delta && pan(delta)) event.preventDefault();
    }

    function restartRoute(event: MouseEvent) {
      const end = marks.at(-1) ?? 0;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!enabled() || window.scrollY < end - 10) {
        enterLap(++turn);
        return;
      }
      event.preventDefault();
      pan(end - window.scrollY, true);
      window.history.replaceState(window.history.state, '', '#broadcast');
      document.getElementById('broadcast-title')?.focus({ preventScroll: true });
    }

    function beginSwipe(event: TouchEvent) {
      const point = event.touches[0];
      touch = enabled() && point && event.touches.length === 1 && !scrollsSeparately(event.target)
        ? { id: point.identifier, x: point.clientX, y: point.clientY, lastY: point.clientY, edge: 0, blocked: 0, manual: false }
        : null;
    }

    function moveSwipe(event: TouchEvent) {
      const point = event.touches[0];
      if (!touch || !enabled() || event.touches.length !== 1 || point.identifier !== touch.id) return;
      const delta = touch.lastY - point.clientY;
      touch.lastY = point.clientY;
      if (touch.manual) {
        if (event.cancelable && pan(delta, true)) event.preventDefault();
        return;
      }
      const vertical = Math.abs(touch.y - point.clientY);
      if (vertical < 12 || Math.abs(touch.x - point.clientX) > vertical * .85) return;
      const end = marks.at(-1) ?? 0;
      const edge = delta > 0 && window.scrollY >= end - 2 ? 1 : delta < 0 && window.scrollY <= 1 ? -1 : 0;
      touch.blocked = edge ? (touch.edge === edge ? touch.blocked : 0) + delta : 0;
      touch.edge = edge;
      // When native scrolling already owns the gesture, finish the spill on lift.
      if (edge && event.cancelable && pan(delta)) {
        touch.manual = true;
        event.preventDefault();
      }
    }

    function endSwipe() {
      const gesture = touch;
      touch = null;
      if (!gesture || gesture.manual || !gesture.edge || Math.abs(gesture.blocked) < 19 || !enabled()) return;
      pan(Math.max(-window.innerHeight * .28, Math.min(window.innerHeight * .28, gesture.blocked)));
    }

    function cancelSwipe() {
      touch = null;
    }

    const returnLink = returning?.querySelector<HTMLElement>('.route-return-link');
    motionChanged.current = measure;
    measure();
    cancelAnimationFrame(requested);
    update();

    try {
      dispose = mountArtwork(target, {
        progress: () => position,
        chapterAt: (progress: number) => cycleChapter(progress, atEnd),
        sceneAt: routeScene,
        present,
        variant: () => 0,
        reduced: () => paused.current,
        live: true,
        radio: signal.read,
        dispatch: dispatch.current,
        greetings: () => departures.current.splice(0),
        messages: () => feed.current,
        selectedGreeting: () => chosen.current,
        projectParcels,
        presentGreeting,
        ready: () => {
          element.classList.add('has-cgi');
          setMotionReady(true);
        },
      });
    } catch {
      setUnavailable(true);
    }

    const observer = new ResizeObserver(measure);
    sections.forEach(section => { if (section) observer.observe(section); });
    if (header) observer.observe(header);
    if (dock) observer.observe(dock);
    if (returning) observer.observe(returning);
    if (circuit) observer.observe(circuit);
    if (screen) observer.observe(screen);
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('wheel', continueRoute, { passive: false });
    window.addEventListener('keydown', continueKeys);
    window.addEventListener('touchstart', beginSwipe, { passive: true });
    window.addEventListener('touchmove', moveSwipe, { passive: false });
    window.addEventListener('touchend', endSwipe, { passive: true });
    window.addEventListener('touchcancel', cancelSwipe, { passive: true });
    returnLink?.addEventListener('click', restartRoute);
    window.addEventListener('resize', measure, { passive: true });
    window.visualViewport?.addEventListener('resize', measure, { passive: true });

    return () => {
      motionChanged.current = null;
      cancelAnimationFrame(requested);
      observer.disconnect();
      window.removeEventListener('scroll', queue);
      window.removeEventListener('wheel', continueRoute);
      window.removeEventListener('keydown', continueKeys);
      window.removeEventListener('touchstart', beginSwipe);
      window.removeEventListener('touchmove', moveSwipe);
      window.removeEventListener('touchend', endSwipe);
      window.removeEventListener('touchcancel', cancelSwipe);
      returnLink?.removeEventListener('click', restartRoute);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      dispose?.();
      targets?.replaceChildren();
      if (preview) preview.hidden = true;
    };
  }, [signal, setMotionReady, departures, feed, chosen, enterLap]);

  return <>
    <div ref={stage} className="stage live-stage" aria-hidden="true">
      {unavailable && <div className="stage-still" />}
      <noscript><div className="stage-still" /></noscript>
      <canvas ref={canvas} className="route-canvas" />
      <div className="stage-filter stage-filter-hero" />
      <div className="stage-filter stage-filter-activity" />
      <div className="stage-filter stage-filter-television" />
      <div className="stage-filter stage-filter-chat" />
      <div className="stage-filter stage-filter-archive" />
      <div className="stage-vignette" />
    </div>
    <canvas ref={dispatch} className="greeting-flight" aria-hidden="true" />
    <nav ref={navigation} className="route-nav" aria-label="На высоких скоростях!">
      {chapters.map(([id, label], i) => blockPresentation(edition, id).visible &&
        <a key={id} href={'#' + id} aria-label={id === 'broadcast' ? edition.hero.title + ' ' + edition.hero.accent : label}
          title={label} aria-current={active === i ? 'location' : undefined}><i /></a>)}
    </nav>
  </>;
}
