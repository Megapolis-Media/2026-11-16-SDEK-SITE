export type SupportVisitor = { id: number; kind: 'guest'; name: string };
export type CentralTicket = { id: number; ticketId: string; status: string; subject: string };
export type CentralMessage = { id: number; body: string; authorName: string; authorType: string; thread: 'client'; createdAt: string };
export type CentralMessages = { ticket: CentralTicket; messages: CentralMessage[]; nextCursor: number; hasMore: boolean };
