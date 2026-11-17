import type { ReactNode } from 'react';

export type IconName = 'play' | 'pause' | 'stop' | 'volume' | 'mute' | 'phone' | 'send' | 'video' | 'chat' | 'clock' | 'down' | 'loop' | 'upRight' | 'close' | 'parcel' | 'error' | 'check' | 'copy';

const shapes: Record<IconName, ReactNode> = {
  play: <path d="m9 5 11 7-11 7z" fill="currentColor" stroke="none" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none" />,
  volume: <><path d="M3 10v4h4l4 3V7l-4 3zM14 9.2a4 4 0 0 1 0 5.6m2-8a7 7 0 0 1 0 10.4" /></>,
  mute: <><path d="M3 10v4h4l4 3V7l-4 3zm11 .3 4 4m0-4-4 4" /></>,
  pause: <path d="M9 6v12m6-12v12" strokeWidth="2.5" />,
  phone: <path d="M8 4H5a1 1 0 0 0-1 1 15 15 0 0 0 15 15 1 1 0 0 0 1-1v-3l-5-2-1.5 2a11 11 0 0 1-5.5-5.5L10 9Z" />,
  send: <><path d="M21 3 10 14m11-11-7 18-4-7-7-4Z" /></>,
  video: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none" /></>,
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 9 9 0 0 1-3.8-.8L4 21l1.8-4.6A8.5 8.5 0 1 1 21 11.5ZM8 12h8" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  loop: <path d="M12 12c-2.6-3.4-3.9-4.2-5.8-4.2a4.2 4.2 0 1 0 0 8.4c1.9 0 3.2-.8 5.8-4.2s3.9-4.2 5.8-4.2a4.2 4.2 0 1 1 0 8.4c-1.9 0-3.2-.8-5.8-4.2Z" />,
  down: <path d="M12 4v15m-5-5 5 5 5-5" />,
  upRight: <path d="M6 18 18 6M8 6h10v10" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  parcel: <path d="m12 3 8.5 4.8v8.4L12 21l-8.5-4.8V7.8ZM3.7 8 12 12.7 20.3 8M12 12.7V21m-4-15.7 8 4.6" />,
  error: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8v4.8m0 3h.01" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 5V4H6a2 2 0 0 0-2 2v10h1" /></>,
};

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{shapes[name]}</svg>;
}
