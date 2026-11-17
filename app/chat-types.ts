export type GreetingMessage = {
  id: string;
  body: string;
  createdAt: number;
  authorName: string;
  editorial: boolean;
  parentId: string | null;
  parentName: string | null;
  threadId: string | null;
  replyCount: number;
  imageUrl: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
};

export type ChatFeed = { messages: GreetingMessage[]; traffic: GreetingMessage[]; older: string | null; moderation: number };
export type ChatThread = { root: GreetingMessage; replies: GreetingMessage[]; older: string | null };
export type TrackItem = {
  id: string; title: string; artist: string; authorName: string; phase: string; createdAt: number; acceptedAt: number | null;
};

export const editorName = 'Редакция CDEK FM';
export const messageLimit = 400;
export const maxImageBytes = 2 * 1024 * 1024;
export const maxImageEdge = 1600;
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let temporaryId = '';

export function chatClient() {
  try {
    const value = localStorage.getItem('cdek-fm-chat-client');
    if (value && uuid.test(value)) return value;
    temporaryId ||= crypto.randomUUID();
    localStorage.setItem('cdek-fm-chat-client', temporaryId);
  } catch {
    temporaryId ||= crypto.randomUUID();
  }
  return temporaryId;
}

export function getNickname() {
  try { return localStorage.getItem('cdek-fm-chat-name') ?? ''; } catch { return ''; }
}

export function saveNickname(value: string) {
  try { localStorage.setItem('cdek-fm-chat-name', value); } catch { /* The visitor can still post. */ }
}
