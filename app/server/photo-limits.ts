import { env } from 'cloudflare:workers';
import { dailyPhotoLimit, type PhotoAllowance } from '../chat-types';

const dayLength = 86_400_000;
const moscowOffset = 10_800_000;

export async function photoAllowance(authorKey: string, now = Date.now()): Promise<PhotoAllowance> {
  if (!env.DB) throw new Error('Chat database is unavailable');
  const day = Math.floor((now + moscowOffset) / dayLength);
  const used = await env.DB.prepare('SELECT used FROM chat_photo_daily WHERE author_key = ? AND day = ?')
    .bind(authorKey, day).first<number>('used') ?? 0;
  return { remaining: Math.max(0, dailyPhotoLimit - used), resetsAt: (day + 1) * dayLength - moscowOffset };
}

export const photoDailyError = 'Сегодня вы уже отправили 3 фотографии. Новые фото можно отправить после 00:00 по Москве. Текстовые сообщения доступны.';
