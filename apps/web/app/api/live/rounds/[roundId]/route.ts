import { handleViewRequest } from '../../../../../../../packages/live/src/view-gateway.ts';
import { LiveStore } from '../../../../../../../packages/live/src/store.ts';

export const runtime = 'nodejs';
export const maxDuration = 15;

export async function GET(request: Request, context: { params: Promise<{ roundId: string }> }): Promise<Response> {
  const { roundId } = await context.params;
  return handleViewRequest(request, {
    roundId,
    store: () => new LiveStore({
      supabaseUrl: process.env.SUPABASE_URL ?? '',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    }),
  });
}
