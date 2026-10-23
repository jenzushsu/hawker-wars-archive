import { describe, expect, it, vi } from 'vitest';
import { handleViewRequest } from '../packages/live/src/view-gateway.ts';
import { LiveStore, LiveStoreError } from '../packages/live/src/store.ts';
import type { PublicView } from '../packages/live/src/public-view.ts';
const roundId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const policies = { policies: [{ policy_id: 'rules' as const, cash_cents: 100, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0 }] };
const view: PublicView = {
  schemaVersion: 'live-view-1',
  snapshot: { schemaVersion: 'live-snapshot-1', round_id: roundId, classification: 'exhibition', tick: 1, sequence: 2,
    status: 'running', configuration_hash: 'a'.repeat(64), control_state: 'active', control_revision: 0, snapshot: policies },
  events: { high_water: 2, events: [1, 2].map(sequence => ({ round_id: roundId, sequence, tick: sequence - 1, event_type: 'tick-committed', snapshot: policies })) },
  vote_window: null, vote_result: null, server_time_ms: 1000,
};
function gateway(query = '', id = roundId, method = 'GET') {
  const getView = vi.fn().mockResolvedValue(view);
  const store = vi.fn(() => ({ getView }));
  return { getView, store, run: () => handleViewRequest(new Request(`https://example.test/api/live/rounds/${id}${query}`, { method }), { roundId: id, store }) };
}
function client(value: unknown = view, status = 200) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value, { status }));
  return { transport, store: new LiveStore({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'fixture-private-service-key', fetch: transport }) };
}
describe('public view gateway', () => {
  it('canonicalizes the round and defaults bounded pagination', async () => {
    const g = gateway('', roundId.toUpperCase()); const response = await g.run();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(view);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(g.getView).toHaveBeenCalledExactlyOnceWith({ roundId, afterSequence: 0, limit: 100 });
  });
  it('accepts a bounded resume cursor', async () => {
    const g = gateway('?after=121&limit=1'); await g.run();
    expect(g.getView).toHaveBeenCalledExactlyOnceWith({ roundId, afterSequence: 121, limit: 1 });
  });
  it.each(['?after=-1', '?after=122', '?after=01', '?after=1e2', '?after=', '?limit=0', '?limit=101', '?limit=01', '?after=1&after=2', '?limit=1&limit=2', '?secret=x'])('rejects %s before configuration lookup', async query => {
    const g = gateway(query); expect((await g.run()).status).toBe(400); expect(g.store).not.toHaveBeenCalled();
  });
  it('rejects malformed round and non-GET before configuration lookup', async () => {
    const badRound = gateway('', 'invalid');
    expect((await badRound.run()).status).toBe(400); expect(badRound.store).not.toHaveBeenCalled();
    const post = gateway('', roundId, 'POST');
    expect((await post.run()).status).toBe(405); expect(post.store).not.toHaveBeenCalled();
  });
  it.each([[null, 404, 'round-not-found'], [new LiveStoreError('http', 409), 409, 'view-cursor-conflict'], [new Error('private-secret'), 503, 'live-view-unavailable']])('sanitizes unavailable reads', async (value, status, error) => {
    const g = gateway(); if (value instanceof Error) g.getView.mockRejectedValue(value); else g.getView.mockResolvedValue(value);
    const response = await g.run(); expect(response.status).toBe(status); expect(await response.json()).toEqual({ error });
    expect(response.headers.get('cache-control')).toBe('no-store'); expect(g.getView).toHaveBeenCalledTimes(1);
  });
  it('reports absent server configuration only when a valid read is attempted', async () => {
    const response = await handleViewRequest(new Request('https://example.test'), { roundId, store: () => { throw new Error('secret'); } });
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: 'live-view-unavailable' });
  });
});
describe('atomic public view store', () => {
  it('makes one RPC with correlated cursor and strict public response', async () => {
    const c = client(); expect(await c.store.getView({ roundId, afterSequence: 0 })).toEqual(view);
    expect(c.transport).toHaveBeenCalledTimes(1);
    expect(c.transport.mock.calls[0]![0]).toBe('https://example.supabase.co/rest/v1/rpc/live_get_view');
    expect(JSON.parse(c.transport.mock.calls[0]![1]!.body as string)).toEqual({ p_round_id: roundId, p_after_sequence: 0, p_limit: 100 });
  });
  it('accepts null and caught-up empty pages', async () => {
    expect(await client(null).store.getView({ roundId, afterSequence: 0 })).toBeNull();
    expect(await client({ ...view, events: { high_water: 2, events: [] } }).store.getView({ roundId, afterSequence: 2 })).toMatchObject({ events: { events: [] } });
  });
  it.each([-1, 122, 1.5, NaN])('rejects cursor %s before transport', async afterSequence => {
    const c = client(); await expect(c.store.getView({ roundId, afterSequence })).rejects.toMatchObject({ code: 'input' }); expect(c.transport).not.toHaveBeenCalled();
  });
  it('rejects private fields, mismatched boundaries, rounds, omitted events and cursor gaps', async () => {
    for (const bad of [
      { ...view, recovery: 'secret' },
      { ...view, events: { ...view.events, high_water: 3 } },
      { ...view, snapshot: { ...view.snapshot, round_id: '11111111-1111-4111-8111-111111111111' } },
      { ...view, events: { high_water: 2, events: [] } },
      { ...view, events: { high_water: 2, events: [view.events.events[1]] } },
    ]) await expect(client(bad).store.getView({ roundId, afterSequence: 0 })).rejects.toMatchObject({ code: 'response' });
  });
  it('does not retry cursor conflicts', async () => {
    const c = client({ message: 'private database detail' }, 409);
    await expect(c.store.getView({ roundId, afterSequence: 3 })).rejects.toMatchObject({ code: 'http', status: 409 });
    expect(c.transport).toHaveBeenCalledTimes(1);
  });
});
