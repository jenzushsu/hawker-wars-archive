import { handleVoteRequest } from '../../../../../packages/live/src/vote-gateway.ts';
import { LiveStore } from '../../../../../packages/live/src/store.ts';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  return handleVoteRequest(request, {
    signingKey: process.env.HAWKER_VOTE_SESSION_KEY,
    origin: process.env.HAWKER_PUBLIC_ORIGIN,
    store: () => new LiveStore({
      supabaseUrl: process.env.SUPABASE_URL ?? '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    }),
  });
}
