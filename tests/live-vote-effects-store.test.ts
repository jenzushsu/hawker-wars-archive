import { describe, expect, it, vi } from 'vitest';
import { LiveStore } from '../packages/live/src/store.ts';

const roundId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ownerId = '22222222-2222-4222-8222-222222222222';
const ownership = { roundId, ownerId, fence: 9 };
const counts = { bus: 0, rain: 2, 'supplier-delay': 1 };
const resolution = { schemaVersion: 'live-vote-resolution-1', round_id: roundId, window_index: 0,
  counts, winner: 'rain', tied_options: ['rain'], draw_r: null, draw_digest: null, effective_tick: 35 };
const result = { schemaVersion: 'live-vote-result-1', round_id: roundId,
  winner: 'rain', effective_tick: 35, ends_at: 44, counts, applied: false };
function mock(value: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  return { transport, store: new LiveStore({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'private-test-service-key', fetch: transport }) };
}
function body(transport: ReturnType<typeof mock>['transport']) { return JSON.parse(transport.mock.calls[0]![1]!.body as string); }

describe('vote resolution and public result client', () => {
  it('resolves with a canonical round identity and the current database fence only', async () => {
    const { store, transport } = mock(resolution);
    await expect(store.resolveVoteWindow({ ...ownership, roundId: roundId.toUpperCase() })).resolves.toEqual(resolution);
    expect(transport.mock.calls[0]![0]).toBe('https://example.supabase.co/rest/v1/rpc/live_resolve_vote_window');
    expect(body(transport)).toEqual({ p_round_id: roundId, p_owner_id: ownerId, p_fence: 9 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('preserves a not-yet-resolved null without inventing a no-vote result', async () => {
    const { store, transport } = mock(null);
    await expect(store.resolveVoteWindow(ownership)).resolves.toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    await expect(mock(null).store.getVoteResult(roundId)).resolves.toBeNull();
  });
  it('accepts bounded tie evidence and no-vote resolutions without exposing them through the public result', async () => {
    const tied = { ...resolution, counts: { bus: 1, rain: 1, 'supplier-delay': 0 }, winner: 'rain',
      tied_options: ['bus', 'rain'], draw_r: 2_147_483_648, draw_digest: `80000000${'0'.repeat(56)}` };
    await expect(mock(tied).store.resolveVoteWindow(ownership)).resolves.toEqual(tied);
    const empty = { ...resolution, counts: { bus: 0, rain: 0, 'supplier-delay': 0 }, winner: null, tied_options: [] };
    await expect(mock(empty).store.resolveVoteWindow(ownership)).resolves.toEqual(empty);
    await expect(mock({ ...result, winner: null, ends_at: null, counts: empty.counts, applied: true }).store.getVoteResult(roundId)).resolves.toMatchObject({ winner: null, applied: true });
  });
  it('reads a sanitized winner with correct duration and application status', async () => {
    for (const [winner, endsAt] of [['bus', 35], ['rain', 44], ['supplier-delay', 44]] as const) {
      const projected = { ...result, winner, ends_at: endsAt, counts: { bus: 1, rain: 1, 'supplier-delay': 1 }, applied: true };
      const { store, transport } = mock(projected);
      await expect(store.getVoteResult(roundId.toUpperCase())).resolves.toEqual(projected);
      expect(transport.mock.calls[0]![0]).toBe('https://example.supabase.co/rest/v1/rpc/live_get_vote_result');
      expect(body(transport)).toEqual({ p_round_id: roundId });
    }
  });
  it('rejects caller-controlled resolution data and malformed identities before dispatch', async () => {
    const { store, transport } = mock(null);
    for (const patch of [{ fence: 0 }, { fence: -0 }, { fence: 1.5 }, { fence: Number.MAX_SAFE_INTEGER + 1 },
      { ownerId: 'bad' }, { roundId: 'bad' }, { seed: 7 }, { winner: 'rain' }, { effectiveTick: 35 }]) {
      await expect(store.resolveVoteWindow({ ...ownership, ...patch } as never)).rejects.toMatchObject({ code: 'input' });
    }
    await expect(store.getVoteResult('bad')).rejects.toMatchObject({ code: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects miscorrelated and inconsistent private resolution acknowledgements', async () => {
    for (const patch of [{ round_id: ownerId }, { window_index: 1 }, { seed: 7 }, { effective_tick: 30 },
      { effective_tick: 120 }, { winner: 'bus' }, { tied_options: ['bus', 'rain'] }, { draw_r: 0 },
      { counts: { bus: 0, rain: 401, 'supplier-delay': 0 } }, { draw_digest: 'a'.repeat(64) }]) {
      await expect(mock({ ...resolution, ...patch }).store.resolveVoteWindow(ownership)).rejects.toMatchObject({ code: 'response' });
    }
  });
  it('rejects private leakage, mismatched boundaries and impossible public winners', async () => {
    for (const patch of [{ round_id: ownerId }, { seed: 7 }, { draw_r: 1 }, { tied_options: ['rain'] },
      { session_id: ownerId }, { winner: 'bus' }, { winner: null }, { effective_tick: 30 }, { effective_tick: 120 },
      { ends_at: 45 }, { ends_at: null }, { applied: 'true' },
      { counts: { bus: 200, rain: 201, 'supplier-delay': 0 } }, { counts: { bus: 0, rain: 0, 'supplier-delay': 0 } },
      { counts: { bus: 0, rain: 2, 'supplier-delay': 1, private: 1 } }]) {
      await expect(mock({ ...result, ...patch }).store.getVoteResult(roundId)).rejects.toMatchObject({ code: 'response' });
    }
  });
  it('never redispatches an uncertain resolution and preserves known HTTP conflicts', async () => {
    const uncertain = mock(resolution);
    uncertain.transport.mockRejectedValueOnce(new Error('private lost acknowledgement'));
    await expect(uncertain.store.resolveVoteWindow(ownership)).rejects.toMatchObject({ code: 'transport', message: 'Live store transport failure' });
    expect(uncertain.transport).toHaveBeenCalledTimes(1);
    const conflict = mock({ secret: 'not exposed' }, 409);
    await expect(conflict.store.resolveVoteWindow(ownership)).rejects.toMatchObject({ code: 'http', status: 409, message: 'Live store http failure' });
    expect(conflict.transport).toHaveBeenCalledTimes(1);
  });
});
