export const centralStatuses = ['NEW', 'IN_PROGRESS', 'CLOSED'] as const;
export type CentralStatus = typeof centralStatuses[number];
export const centralStatusLabels: Record<CentralStatus, string> = {
  NEW: 'Новая', IN_PROGRESS: 'В работе', CLOSED: 'Закрыта',
};
export type CentralSiteTicket = {
  id: number; ticketId: string; subject: string; visitorName: string;
  status: CentralStatus; createdAt: string; takenAt: string | null; closedAt: string | null;
};
export type CentralSitePage = {
  tickets: CentralSiteTicket[]; hasMore: boolean; nextCursor: number | null;
};
export const centralSupportUrl = 'https://help.megapolis.media/websites/support';
