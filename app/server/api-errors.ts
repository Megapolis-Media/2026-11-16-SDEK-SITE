import { json } from './studio';

// Clients retry temporary failures and expect JSON, including when a database
// query fails before the handler reaches its normal response path.
export function withApiErrors<Args extends unknown[]>(handler: (...args: Args) => Promise<Response>, message: string) {
  return async (...args: Args): Promise<Response> => {
    try { return await handler(...args); }
    catch {
      console.error('API unavailable:', message);
      return json({ error: message }, 503);
    }
  };
}
