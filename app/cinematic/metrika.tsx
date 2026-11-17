'use client';

import { useEffect } from 'react';

type Counter = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

declare global {
  interface Window { ym?: Counter; cdekMetrika?: string }
}

export function metric(goal: 'chat_message' | 'track_request' | 'radio_play' | 'video_open') {
  if (window.cdekMetrika) window.ym?.(Number(window.cdekMetrika), 'reachGoal', goal);
}

export function Metrika({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    if (!window.ym) {
      const queue: Counter = (...args: unknown[]) => { (queue.a ??= []).push(args); };
      queue.l = Date.now();
      window.ym = queue;
    }
    const source = 'https://mc.yandex.ru/metrika/tag.js?id=' + id;
    const previousScript = document.querySelector<HTMLScriptElement>('script[data-cdek-metrika]');
    if (previousScript?.src !== source) {
      const script = document.createElement('script');
      script.async = true;
      script.src = source;
      script.dataset.cdekMetrika = '';
      if (previousScript) previousScript.replaceWith(script);
      else document.head.appendChild(script);
    }
    window.cdekMetrika = id;
    window.ym(Number(id), 'init', {
      ssr: true,
      webvisor: true,
      clickmap: true,
      ecommerce: 'dataLayer',
      referrer: document.referrer,
      url: window.location.href,
      accurateTrackBounce: true,
      trackLinks: true,
    });
    return () => {
      window.ym?.(Number(id), 'destruct');
      if (window.cdekMetrika === id) delete window.cdekMetrika;
    };
  }, [id]);
  return id ? <noscript>
    <img src={'https://mc.yandex.ru/watch/' + id} width={1} height={1}
      style={{ position: 'absolute', left: -9999 }} alt="" />
  </noscript> : null;
}
