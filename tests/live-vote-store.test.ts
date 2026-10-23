import { describe, expect, it, vi } from 'vitest';
import { LiveStore } from '../packages/live/src/store.ts';

const roundId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ownerId = '22222222-2222-4222-8222-222222222222';
const sessionId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const window = { schemaVersion: 'live-vote-window-1', round_id: roundId, window_index: 0,
  status: 'open', paused: false, deadline_ms: 20_000, remaining_ms: 10_000,
  counts: { bus: 1, rain: 2, 'supplier-delay': 0 }, eligible_options: ['bus', 'rain', 'supplier-delay'] };
const receipt = { schemaVersion: 'live-vote-receipt-1', round_id: roundId, window_index: 0,
  request_id: requestId, option_id: 'rain', accepted_at_ms: 10_000, replayed: false };
const submission = { roundId, sessionId, requestId, optionId: 'rain' as const };
function mock(value: unknown, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
  }));
  return { transport, store: new LiveStore({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'private-test-service-key', fetch: transport }) };
}
function body(transport: ReturnType<typeof mock>['transport']) { return JSON.parse(transport.mock.calls[0]![1]!.body as string); }

describe('strict durable voting client', () => {
  it('opens a window using only the current database fence and canonical round identity', async () => {
    const { store, transport } = mock(window);
    await expect(store.openVoteWindow({ roundId: roundId.toUpperCase(), ownerId, fence: 9 })).resolves.toEqual(window);
    expect(transport.mock.calls[0]![0]).toBe('https://example.supabase.co/rest/v1/rpc/live_open_vote_window');
    expect(body(transport)).toEqual({ p_round_id: roundId, p_owner_id: ownerId, p_fence: 9 });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('submits an authenticated session identity without client timestamps or eligibility authority', async () => {
    const { store, transport } = mock(receipt);
    await expect(store.submitVote({ ...submission, roundId: roundId.toUpperCase() })).resolves.toEqual(receipt);
    expect(transport.mock.calls[0]![0]).toContain('/rpc/live_submit_vote');
    expect(body(transport)).toEqual({ p_round_id: roundId, p_session_id: sessionId, p_request_id: requestId, p_option_id: 'rain' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('reads sanitized windows and session-private current receipts with nullable absence', async () => {
    const publicRead = mock(window);
    await expect(publicRead.store.getVoteWindow(roundId)).resolves.toEqual(window);
    expect(body(publicRead.transport)).toEqual({ p_round_id: roundId });
    const privateRead = mock(receipt);
    await expect(privateRead.store.getVoteReceipt({ roundId, sessionId })).resolves.toEqual(receipt);
    expect(privateRead.transport.mock.calls[0]![0]).toContain('/rpc/live_get_vote_receipt');
    expect(body(privateRead.transport)).toEqual({ p_round_id: roundId, p_session_id: sessionId });
    await expect(mock(null).store.getVoteWindow(roundId)).resolves.toBeNull();
    await expect(mock(null).store.getVoteReceipt({ roundId, sessionId })).resolves.toBeNull();
  });
  it('accepts paused, elapsed and disabled projections without inventing eligibility', async () => {
    for (const patch of [
      { paused: true, deadline_ms: null, eligible_options: [] },
      { status: 'locked', deadline_ms: null, remaining_ms: 0, eligible_options: [] },
      { status: 'locked', paused: true, deadline_ms: null, remaining_ms: 0, eligible_options: [] },
      { status: 'disabled', deadline_ms: null, remaining_ms: 0, eligible_options: [] },
    ]) await expect(mock({ ...window, ...patch }).store.getVoteWindow(roundId)).resolves.toMatchObject(patch);
  });
  it('rejects malformed identities and forged clock/effect fields before dispatch', async () => {
    const { store, transport } = mock(null);
    for (const patch of [{ sessionId: 'forged' }, { requestId: 'bad' }, { optionId: 'unknown' }, { serverTime: 1 }, { effect: {} }, { optionId: null }]) {
      await expect(store.submitVote({ ...submission, ...patch } as never)).rejects.toMatchObject({ code: 'input' });
    }
    for (const patch of [{ fence: 0 }, { fence: -0 }, { fence: 1.5 }, { ownerId: 'bad' }, { deadlineMs: 1 }]) {
      await expect(store.openVoteWindow({ roundId, ownerId, fence: 1, ...patch } as never)).rejects.toMatchObject({ code: 'input' });
    }
    await expect(store.getVoteReceipt({ roundId, sessionId, requestId } as never)).rejects.toMatchObject({ code: 'input' });
    await expect(store.getVoteWindow('bad')).rejects.toMatchObject({ code: 'input' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects private data, impossible counts and contradictory eligibility in window responses', async () => {
    for (const patch of [
      { round_id: ownerId }, { window_index: 1 }, { status: 'resolved' }, { seed: 7 }, { session_id: sessionId },
      { counts: { bus: 200, rain: 201, 'supplier-delay': 0 } }, { counts: { bus: -1, rain: 0, 'supplier-delay': 0 } },
      { counts: { bus: 1, rain: 2, 'supplier-delay': 0, private: 0 } }, { remaining_ms: 20_001 }, { remaining_ms: 0 },
      { deadline_ms: null }, { paused: true }, { eligible_options: ['bus', 'bus', 'rain'] }, { eligible_options: [] },
      { status: 'locked', remaining_ms: 0 }, { status: 'disabled', remaining_ms: 0, eligible_options: [] },
    ]) await expect(mock({ ...window, ...patch }).store.getVoteWindow(roundId)).rejects.toMatchObject({ code: 'response' });
    await expect(mock({ ...window, round_id: ownerId }).store.openVoteWindow({ roundId, ownerId, fence: 1 })).rejects.toMatchObject({ code: 'response' });
  });
  it('correlates the exact original receipt and rejects leaked identity or altered acknowledgements', async () => {
    await expect(mock({ ...receipt, replayed: true }).store.submitVote(submission)).resolves.toMatchObject({ replayed: true });
    for (const patch of [{ round_id: ownerId }, { request_id: ownerId }, { option_id: 'bus' }, { accepted_at_ms: -1 },
      { accepted_at_ms: Number.MAX_SAFE_INTEGER + 1 }, { window_index: 1 }, { session_id: sessionId }, { replayed: 'true' }]) {
      await expect(mock({ ...receipt, ...patch }).store.submitVote(submission)).rejects.toMatchObject({ code: 'response' });
    }
    await expect(mock({ ...receipt, round_id: ownerId }).store.getVoteReceipt({ roundId, sessionId })).rejects.toMatchObject({ code: 'response' });
  });
  it('preserves conflict and rate-limit statuses without retrying accepted or uncertain requests', async () => {
    for (const status of [409, 429]) {
      const { store, transport } = mock({ private: 'not exposed' }, status);
      await expect(store.submitVote(submission)).rejects.toMatchObject({ code: 'http', status, message: 'Live store http failure' });
      expect(transport).toHaveBeenCalledTimes(1);
    }
    const { store, transport } = mock(receipt);
    transport.mockRejectedValueOnce(new Error('secret lost acknowledgement'));
    await expect(store.submitVote(submission)).rejects.toMatchObject({ code: 'transport', message: 'Live store transport failure' });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
