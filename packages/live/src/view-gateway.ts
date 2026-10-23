import { z } from 'zod';
import { LiveStoreError, type LiveStore } from './store.ts';

export interface ViewGatewayOptions {
  roundId: string;
  store: () => Pick<LiveStore, 'getView'>;
}
function reply(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
/** Public reads only. No cookies, leases, round creation, simulation or provider work. */
export async function handleViewRequest(request: Request, options: ViewGatewayOptions): Promise<Response> {
  if (request.method !== 'GET') return reply(405, { error: 'method-not-allowed' });
  let roundId: string, afterSequence: number, limit: number;
  try {
    roundId = z.string().uuid().parse(options.roundId).toLowerCase();
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['after', 'limit'].includes(key)) || query.getAll('after').length > 1 || query.getAll('limit').length > 1) throw new Error();
    const after = query.get('after') ?? '0', size = query.get('limit') ?? '100';
    if (!/^(0|[1-9]\d{0,2})$/.test(after) || !/^[1-9]\d{0,2}$/.test(size)) throw new Error();
    afterSequence = Number(after); limit = Number(size);
    if (afterSequence > 121 || limit > 100) throw new Error();
  } catch { return reply(400, { error: 'invalid-view-request' }); }
  try {
    const view = await options.store().getView({ roundId, afterSequence, limit });
    return view === null ? reply(404, { error: 'round-not-found' }) : reply(200, view);
  } catch (error) {
    if (error instanceof LiveStoreError && error.code === 'http' && error.status === 409) return reply(409, { error: 'view-cursor-conflict' });
    return reply(503, { error: 'live-view-unavailable' });
  }
}
