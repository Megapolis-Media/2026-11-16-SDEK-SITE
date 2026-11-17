'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ChatFeed, GreetingMessage } from '../chat-types';
import { Icon } from './icons';

export type { GreetingMessage } from '../chat-types';
export type GreetingPreview = { id: string; waitForLanding: boolean };
type Frame = { x: number; y: number; width: number; height: number };
export type GreetingCard = {
  rect: DOMRect; width: number; height: number; formTop: number; input: Frame; send: Frame;
  lines: (Frame & { text: string; time: string })[];
  photo?: Frame & { canvas: HTMLCanvasElement };
};
type Departure = { message: GreetingMessage; card: GreetingCard; inCircuit: boolean };

function messageOrder(a: GreetingMessage, b: GreetingMessage) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function merge(previous: GreetingMessage[], incoming: GreetingMessage[]) {
  const merged = new Map(previous.map(item => [item.id, item]));
  incoming.forEach(item => merged.set(item.id, item));
  return [...merged.values()].sort(messageOrder);
}

function unchanged(a: GreetingMessage[], b: GreetingMessage[]) {
  return a.length === b.length && a.every((item, index) =>
    item.id === b[index].id && item.replyCount === b[index].replyCount);
}

function useGreetingController(eager: boolean) {
  const [messages, setMessages] = useState<GreetingMessage[]>([]);
  const [older, setOlder] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [recent, setRecent] = useState<GreetingMessage>();
  const [moderation, setModeration] = useState(0);
  const extended = useRef(false);
  const moderationRevision = useRef(0);
  const latestRootPage = useRef('');
  const packedAt = useRef<number | null>(null);
  const lap = useRef(0);
  const feed = useRef<GreetingMessage[] | null>(null);
  const chosen = useRef<GreetingPreview | null>(null);
  const departures = useRef<Departure[]>([]);
  const posting = useRef(false);
  const refreshing = useRef(false);
  const revision = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (document.hidden || posting.current || refreshing.current) return;
    refreshing.current = true;
    const before = revision.current;
    try {
      const response = await fetch('/api/chat', { cache: 'no-store', signal });
      if (!response.ok) throw new Error('Chat feed unavailable');
      const result: ChatFeed = await response.json();
      if (signal?.aborted || posting.current || before !== revision.current) return;
      const { traffic } = result;
      const moderated = result.moderation !== moderationRevision.current;
      if (moderated) {
        moderationRevision.current = result.moderation;
        revision.current++;
        extended.current = false;
        chosen.current = null;
        departures.current = [];
        setSelected(null);
        setRecent(undefined);
        setModeration(result.moderation);
      }
      if (!unchanged(feed.current ?? [], traffic) || feed.current === null) feed.current = traffic;
      const rootPage = result.messages.map(item => item.id + ':' + item.replyCount).join();
      if (moderated || rootPage !== latestRootPage.current) {
        latestRootPage.current = rootPage;
        setMessages(previous => extended.current ? merge(previous, result.messages) : result.messages);
      }
      if (!extended.current) setOlder(result.older);
      setLoadState('ready');
    } catch {
      if (!signal?.aborted) setLoadState('error');
    } finally { refreshing.current = false; }
  }, []);

  useEffect(() => {
    const sections = ['chat', 'circuit-chat'].map(id => document.getElementById(id)).filter(element => element !== null);
    const near = new Set<Element>();
    const abort = new AbortController();
    const update = () => { if (eager || near.size) void refresh(abort.signal); };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) near.add(entry.target);
        else near.delete(entry.target);
      }
      update();
    }, { rootMargin: '390px 0px' });
    sections.forEach(element => observer.observe(element));
    update();
    const timer = window.setInterval(update, 4000);
    document.addEventListener('visibilitychange', update);
    return () => {
      abort.abort();
      observer.disconnect();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [eager, refresh]);

  const moreRoots = useCallback(async () => {
    if (!older) return;
    const before = revision.current;
    const response = await fetch('/api/chat?before=' + older, { cache: 'no-store' });
    if (response.status === 404) { await refresh(); return; }
    if (!response.ok) throw new Error('Chat history unavailable');
    const result: ChatFeed = await response.json();
    if (before !== revision.current) return;
    if (result.moderation !== moderationRevision.current) { await refresh(); return; }
    extended.current = true;
    setMessages(previous => merge(previous, result.messages));
    setOlder(result.older);
  }, [older, refresh]);

  const reopen = useCallback(() => {
    packedAt.current = null;
    setOpen(true);
  }, []);

  const enterLap = useCallback((turn: number) => {
    lap.current = turn;
    if (packedAt.current !== null && packedAt.current !== turn) reopen();
  }, [reopen]);

  const choose = useCallback((id: string, waitForLanding = false) => {
    chosen.current = { id, waitForLanding };
    setSelected(id);
  }, []);

  const beginSend = useCallback(() => {
    if (posting.current) return false;
    posting.current = true;
    revision.current++;
    return true;
  }, []);

  const finishSend = useCallback((message?: GreetingMessage, card?: GreetingCard, inCircuit = false, foldPanel = false) => {
    posting.current = false;
    if (!message) return;
    if (card) departures.current.push({ message, card, inCircuit });
    if (foldPanel) {
      packedAt.current = lap.current;
      setOpen(false);
    }
    feed.current = merge(feed.current ?? [], [message]).slice(-80);
    setRecent(message);
    setMessages(previous => message.threadId
      ? previous.map(item => item.id === message.threadId ? { ...item, replyCount: item.replyCount + 1 } : item)
      : merge(previous, [message]));
    latestRootPage.current = '';
    choose(message.id, Boolean(card));
    void refresh();
  }, [choose, refresh]);

  return { messages, older, moreRoots, refresh, loadState, open, selected, recent, moderation, enterLap, reopen, choose,
    beginSend, finishSend, feed, chosen, departures };
}

const GreetingContext = createContext<ReturnType<typeof useGreetingController> | null>(null);

export function GreetingProvider({ children, eager = false }: { children: ReactNode; eager?: boolean }) {
  const state = useGreetingController(eager);
  return <GreetingContext.Provider value={state}>{children}</GreetingContext.Provider>;
}

export function useGreetings() {
  const state = useContext(GreetingContext);
  if (!state) throw new Error('CDEK FM chat provider is missing');
  return state;
}

export function GreetingLink({ className, target = 'circuit-chat' }: { className: string; target?: 'chat' | 'circuit-chat' }) {
  const { open, reopen } = useGreetings();
  return <a className={className} href={'#' + target} aria-controls={target === 'chat' ? 'greeting-panel' : undefined}
    aria-expanded={target === 'chat' ? open : undefined} onClick={reopen}>
    <Icon name="send" size={16} /><span>Передать привет</span>
  </a>;
}
