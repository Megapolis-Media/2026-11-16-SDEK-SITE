import { AsyncLocalStorage } from 'node:async_hooks';
import { localDB, localBucket } from '../server/storage.mjs';

const requests = new AsyncLocalStorage();
export const env = { DB: localDB, BUCKET: localBucket };

export function withRequest(request, handler, ...args) {
  return requests.run(request, () => handler(request, ...args));
}

export async function headers() { return requests.getStore()?.headers ?? new Headers(); }
export async function cookies() {
  const cookie = (await headers()).get('cookie') ?? '';
  const values = new Map(cookie.split(';').map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), { value: part.slice(index + 1) }];
  }));
  return { get: name => values.get(name) };
}
