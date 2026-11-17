import { z } from 'zod';

export const supportStatuses = ['new', 'in_progress', 'resolved'] as const;
export const supportStatus = z.enum(supportStatuses);
export type SupportStatus = z.infer<typeof supportStatus>;

export const supportStatusLabels: Record<SupportStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  resolved: 'Решена',
};

export const supportDescriptionLimit = 3000;
export const supportEmail = z.string().trim().max(254).email('Укажите действующий email.');
export const supportId = z.string().uuid();
export const supportStatusChange = z.strictObject({
  id: supportId,
  status: supportStatus,
  updatedAt: z.number().int().nonnegative(),
});

export type SupportTicket = {
  id: string;
  number: number;
  email: string;
  description: string;
  status: SupportStatus;
  createdAt: number;
  updatedAt: number;
};

export const supportChannels = ['email', 'helpdesk'] as const;
export type SupportChannel = typeof supportChannels[number];
export type SupportDelivery = {
  channel: SupportChannel;
  state: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  updatedAt: number;
  error: string | null;
};

export type SupportInboxPage = {
  tickets: (SupportTicket & { deliveries: SupportDelivery[] })[];
  nextBefore: number | null;
  counts: Record<SupportStatus, number>;
  settings: {
    email: string;
    mailReady: boolean;
    helpdeskReady: boolean;
    apiReady: boolean;
  };
};
