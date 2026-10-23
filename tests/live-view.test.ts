import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicViewSchema, parsePublicView } from '../packages/live/src/public-view.ts';
import { createLiveViewer, initialLiveViewerState, reconcileLiveView, type LiveViewerState } from '../apps/web/lib/live-view.ts';

const roundId = '11111111-1111-4111-8111-111111111111';
const otherRound = '22222222-2222-4222-8222-222222222222';
const metrics = { policies: [{ policy_id: 'rules' as const, cash_cents: 20000, profit_cents: 0, utility_points: 0, served: 0, abandoned: 0 }] };
function view(sequence = 1, after = 0) {
  return { schemaVersion: 'live-view-1' as const,
    snapshot: { schemaVersion: 'live-snapshot-1' as const, round_id: roundId, classification: 'exhibition' as const,
      tick: sequence - 1, sequence, status: sequence === 121 ? 'completed' as const : 'running' as const,
      configuration_hash: 'a'.repeat(64), control_state: 'active' as 'active' | 'paused' | 'stopped', control_revision: 0,
      snapshot: sequence === 0 ? { policies: [] } : structuredClone(metrics) },
    events: { high_water: sequence, events: Array.from({ length: Math.min(100, sequence - after) }, (_, index) => {
      const n = after + index + 1;
      return { round_id: roundId, sequence: n, tick: n - 1, event_type: n === 121 ? 'round-closed' as const : 'tick-committed' as const, snapshot: structuredClone(metrics) };
    }) }, vote_window: null, vote_result: null, server_time_ms: 100000,
  };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const reduce = (state: LiveViewerState, value: unknown, afterSequence = state.cursor) => reconcileLiveView(state, value, { roundId, afterSequence });
afterEach(() => { vi.useRealTimers(); });

describe('public live viewer protocol', () => {
  it('rebuilds a complete closed-round cursor through bounded pages without duplicate history', () => {
    let state = reduce(initialLiveViewerState(), view(121));
    expect(state.cursor).toBe(100); expect(state.view?.snapshot.status).toBe('completed');
    state = reduce(state, view(121, 100));
    expect(state.cursor).toBe(121); expect(state.history).toHaveLength(121);
    state = reduce(state, view(121), 0);
    state = reduce(state, view(121, 100));
    expect(state.history.map(item => item.sequence)).toEqual(Array.from({ length: 121 }, (_, index) => index + 1));
  });
  it('applies control-only updates at the same committed tick without changing history', () => {
    const state = reduce(initialLiveViewerState(), view());
    const paused = view(1, 1); paused.snapshot.control_state = 'paused'; paused.snapshot.control_revision = 1;
    const next = reduce(state, paused);
    expect(next.view?.snapshot.control_state).toBe('paused'); expect(next.history).toEqual(state.history);
    expect(() => reduce(next, view(1, 1))).toThrow();
    expect(() => reduce(state, { ...paused, snapshot: { ...paused.snapshot, control_revision: 0 } })).toThrow();
  });
  it('rejects missing, reordered, foreign and conflicting immutable events', () => {
    const state = reduce(initialLiveViewerState(), view());
    const gap = view(3, 1); gap.events.events.shift();
    const reordered = view(3, 1); reordered.events.events.reverse();
    const foreign = view(2, 1); foreign.events.events[0]!.round_id = otherRound;
    const changed = view(2); changed.events.events[0]!.snapshot.policies[0]!.served = 9;
    expect(() => reduce(state, gap)).toThrow(); expect(() => reduce(state, reordered)).toThrow();
    expect(() => reduce(state, foreign)).toThrow(); expect(() => reduce(state, changed, 0)).toThrow();
    expect(state.history[0]!.snapshot.policies[0]!.served).toBe(0);
  });
  it('rejects private fields, inconsistent boundaries, terminal events, oversized values and wrong request identity', () => {
    for (const value of [
      { ...view(), privateRecovery: {} }, { ...view(), server_time_ms: Number.MAX_SAFE_INTEGER + 1 },
      { ...view(), snapshot: { ...view().snapshot, tick: 2 } },
      { ...view(), events: { high_water: 2, events: view().events.events } },
      { ...view(), events: { high_water: 1, events: [{ ...view().events.events[0], event_type: 'round-closed' }] } },
      { ...view(), snapshot: { ...view().snapshot, snapshot: { policies: [{ ...metrics.policies[0], secret: 'private' }] } } },
    ]) expect(PublicViewSchema.safeParse(value).success).toBe(false);
    expect(() => parsePublicView(view(), { roundId: otherRound, afterSequence: 0 })).toThrow();
    expect(() => parsePublicView(view(), { roundId, afterSequence: 2 })).toThrow();
  });
  it('correlates pending and applied vote results to the authoritative snapshot boundary', () => {
    const counts = { bus: 0, rain: 1, 'supplier-delay': 0 };
    const window = { schemaVersion: 'live-vote-window-1', round_id: roundId, window_index: 0, status: 'locked', paused: false,
      deadline_ms: null, remaining_ms: 0, counts, eligible_options: [] };
    const result = { schemaVersion: 'live-vote-result-1', round_id: roundId, winner: 'rain', effective_tick: 31, ends_at: 40, counts, applied: false };
    expect(PublicViewSchema.safeParse({ ...view(31), vote_window: window, vote_result: result }).success).toBe(true);
    expect(PublicViewSchema.safeParse({ ...view(31), vote_window: window, vote_result: { ...result, applied: true } }).success).toBe(false);
    expect(PublicViewSchema.safeParse({ ...view(32), vote_window: window, vote_result: { ...result, applied: true } }).success).toBe(true);
    expect(PublicViewSchema.safeParse({ ...view(32), vote_window: window, vote_result: { ...result, applied: true, draw_r: 99 } }).success).toBe(false);
  });
  it('does not let an older snapshot or changed resolved vote replace confirmed state', () => {
    const state = reduce(initialLiveViewerState(), view(2));
    expect(() => reduce(state, view(1), 0)).toThrow();
    expect(() => reduce(state, { ...view(2, 2), server_time_ms: 99999 })).toThrow();
    const altered = view(2, 2); altered.snapshot.snapshot.policies[0]!.cash_cents = 1;
    expect(() => reduce(state, altered)).toThrow();
  });
});

describe('live viewer polling and recovery', () => {
  it('keeps two independent viewers on the same confirmed round using reads only', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.method).toBe('GET'); expect(init?.credentials).toBe('same-origin');
      const after = Number(new URL(String(input), 'https://app.example').searchParams.get('after'));
      return json(view(1, after));
    });
    const a = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    const b = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    a.start(); b.start(); await vi.advanceTimersByTimeAsync(0);
    expect(a.getState().view).toEqual(b.getState().view); expect(transport).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport).toHaveBeenCalledTimes(4); expect(a.getState().history).toHaveLength(1);
    a.stop(); b.stop();
  });
  it('retains the last good view after a gap and rebuilds from cursor zero', async () => {
    vi.useFakeTimers(); const urls: string[] = [];
    const gap = view(3, 1); gap.events.events.shift();
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(async input => { urls.push(String(input)); return json(view()); })
      .mockImplementationOnce(async input => { urls.push(String(input)); return json(gap); })
      .mockImplementationOnce(async input => { urls.push(String(input)); return json(view(3)); });
    const viewer = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    viewer.start(); await vi.advanceTimersByTimeAsync(2000);
    expect(viewer.getState().connection).toBe('disconnected'); expect(viewer.getState().view?.snapshot.sequence).toBe(1);
    expect(viewer.getState().cursor).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(urls[2]).toContain('after=0'); expect(viewer.getState().connection).toBe('connected');
    expect(viewer.getState().history).toHaveLength(3); viewer.stop();
  });
  it('clears a withdrawn round and never carries old data into an unavailable state', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json(view())).mockResolvedValueOnce(json({}, 404));
    const viewer = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    viewer.start(); await vi.advanceTimersByTimeAsync(2000);
    expect(viewer.getState()).toMatchObject({ connection: 'unavailable', view: null, cursor: 0, history: [] }); viewer.stop();
  });
  it('bounds stalled reads, backs off and permits an immediate explicit reconnect', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(() => {})).mockResolvedValueOnce(json(view()));
    const viewer = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    viewer.start(); await vi.advanceTimersByTimeAsync(9999); expect(transport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(viewer.getState().connection).toBe('disconnected');
    viewer.reconnect(); await vi.advanceTimersByTimeAsync(0);
    expect(viewer.getState().connection).toBe('connected'); expect(transport).toHaveBeenCalledTimes(2); viewer.stop();
  });
  it('ignores an old in-flight response after stop and restart', async () => {
    vi.useFakeTimers(); let resolve!: (response: Response) => void;
    const transport = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise(value => { resolve = value; })).mockResolvedValueOnce(json(view(2)));
    const viewer = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    viewer.start(); viewer.stop(); viewer.start(); await vi.advanceTimersByTimeAsync(0);
    resolve(json(view(1))); await vi.advanceTimersByTimeAsync(0);
    expect(viewer.getState().view?.snapshot.sequence).toBe(2); viewer.stop();
  });
  it('rejects oversized bodies and recovers a server cursor conflict without dispatching a write', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('x'.repeat(262145), { headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(json({}, 409)).mockResolvedValueOnce(json(view()));
    const viewer = createLiveViewer({ roundId, onChange: () => {}, fetch: transport });
    viewer.start(); await vi.advanceTimersByTimeAsync(0); expect(viewer.getState().connection).toBe('disconnected');
    await vi.advanceTimersByTimeAsync(2000); expect(viewer.getState().cursor).toBe(0);
    await vi.advanceTimersByTimeAsync(4000); expect(viewer.getState().connection).toBe('connected'); viewer.stop();
  });
});
