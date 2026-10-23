import { handleOperatorRequest } from '../../../../../../../packages/live/src/operator.ts';
import { LiveStore } from '../../../../../../../packages/live/src/store.ts';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  return handleOperatorRequest(request, {
    token: process.env.HAWKER_OPERATOR_TOKEN,
    actorId: process.env.HAWKER_OPERATOR_ID,
    store: () => new LiveStore({
      supabaseUrl: process.env.SUPABASE_URL ?? '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    }),
  });
}
