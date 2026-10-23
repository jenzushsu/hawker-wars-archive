import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleVoteRequest } from '../packages/live/src/vote-gateway.ts';
import { issueVoteSession, verifyVoteSession } from '../packages/live/src/session.ts';
import { LiveStoreError, type LiveStore } from '../packages/live/src/store.ts';

const key = 'gateway-test-signing-key-only-not-a-production-secret';
const origin = 'https://hawker.example';
const nowMs = 10_000_000;
const roundId = '11111111-1111-4111-8111-111111111111';
const otherRound = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const window = { schemaVersion: 'live-vote-window-1' as const, round_id: roundId, window_index: 0 as const,
  status: 'open' as const, paused: false, deadline_ms: nowMs + 20_000, remaining_ms: 20_000,
  counts: { bus: 0, rain: 0, 'supplier-delay': 0 }, eligible_options: ['bus', 'rain', 'supplier-delay'] as ('bus' | 'rain' | 'supplier-delay')[] };
const receipt = { schemaVersion: 'live-vote-receipt-1' as const, round_id: roundId, window_index: 0 as const,
  request_id: requestId, option_id: 'rain' as const, accepted_at_ms: nowMs, replayed: false };
function setup() {
  const getVoteWindow = vi.fn<LiveStore['getVoteWindow']>().mockResolvedValue(window);
  const getVoteReceipt = vi.fn<LiveStore['getVoteReceipt']>().mockResolvedValue(receipt);
  const getVoteResult = vi.fn<LiveStore['getVoteResult']>().mockResolvedValue(null);
  const submitVote = vi.fn<LiveStore['submitVote']>().mockResolvedValue(receipt);
  const store = vi.fn(() => ({ getVoteWindow, getVoteReceipt, getVoteResult, submitVote }));
  return { getVoteWindow, getVoteReceipt, getVoteResult, submitVote, store, options: { signingKey: key, origin, store, now: () => nowMs } };
}
function request(body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/votes`, { method: 'POST', headers: { origin, 'content-type': 'application/json',
    ...(cookie === undefined ? {} : { cookie }), ...headers }, body: JSON.stringify(body) });
}
function sessionCookie(round = roundId, at = nowMs) {
  return `__Host-hawker-session=${issueVoteSession({ key, roundId: round, nowMs: at }).token}`;
}
const submit = { action: 'submit', roundId, requestId, optionId: 'rain' };
afterEach(() => vi.useRealTimers());

describe('durable voting gateway trust and acknowledgement boundary', () => {
  it('requires canonical server HTTPS origin and signing configuration before backend access', async () => {
    const { options, store } = setup();
    for (const invalid of [{ signingKey: '' }, { signingKey: 'short' }, { origin: '' }, { origin: 'http://hawker.example' },
      { origin: `${origin}/` }, { origin: `${origin}/path` }, { origin: 'https://user@hawker.example' }]) {
      expect((await handleVoteRequest(request({ action: 'session', roundId }), { ...options, ...invalid })).status).toBe(503);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects missing or cross-site origins regardless of cookies or forwarded hosts', async () => {
    const { options, store } = setup();
    for (const supplied of ['', 'null', 'https://evil.example', `${origin}/`, `${origin}:443`]) {
      expect((await handleVoteRequest(request(submit, sessionCookie(), { origin: supplied, 'x-forwarded-host': 'hawker.example' }), options)).status).toBe(403);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects read methods, non-JSON bodies and encoded bodies', async () => {
    const { options, store } = setup();
    expect((await handleVoteRequest(new Request(`${origin}/api/votes`), options)).status).toBe(405);
    for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=latin1' }, { 'content-encoding': 'gzip' }]) {
      expect((await handleVoteRequest(request(submit, sessionCookie(), headers), options)).status).toBe(415);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('mints an HttpOnly round-bound session only for a visible window and never exposes its identity in JSON', async () => {
    const { options, getVoteWindow, store } = setup();
    const result = await handleVoteRequest(request({ action: 'session', roundId }), options);
    expect(result.status).toBe(200);
    const cookie = result.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^__Host-hawker-session=/);
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=3600']) expect(cookie).toContain(attribute);
    const token = cookie.split(';')[0]!.split('=')[1]!;
    expect(verifyVoteSession({ key, roundId, token, nowMs })).not.toBeNull();
    expect(verifyVoteSession({ key, roundId: otherRound, token, nowMs })).toBeNull();
    expect(await result.json()).toEqual({ window });
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.has('access-control-allow-origin')).toBe(false);
    getVoteWindow.mockResolvedValueOnce(null);
    const hidden = await handleVoteRequest(request({ action: 'session', roundId }), options);
    expect(hidden.status).toBe(404); expect(hidden.headers.has('set-cookie')).toBe(false);
    expect(store).toHaveBeenCalledTimes(2);
  });
  it('reuses existing session identity without extending expiry, including locked-window reconnect', async () => {
    const { options, getVoteWindow } = setup();
    const cookie = sessionCookie(roundId, nowMs - 10_000);
    getVoteWindow.mockResolvedValueOnce({ ...window, status: 'locked', remaining_ms: 0, eligible_options: [] });
    const result = await handleVoteRequest(request({ action: 'session', roundId }, cookie), options);
    expect(result.status).toBe(200);
    expect(result.headers.get('set-cookie')).toContain(cookie);
    expect(result.headers.get('set-cookie')).toContain('Max-Age=3590');
  });
  it('does not mint a new identity once the window is locked or disabled', async () => {
    const { options, getVoteWindow } = setup();
    for (const status of ['locked', 'disabled'] as const) {
      getVoteWindow.mockResolvedValueOnce({ ...window, status, remaining_ms: 0, eligible_options: [] });
      const result = await handleVoteRequest(request({ action: 'session', roundId }), options);
      expect(result.status).toBe(409); expect(result.headers.has('set-cookie')).toBe(false);
    }
  });
  it('rejects unsigned, forged, expired and other-round cookies without constructing storage', async () => {
    const { options, store } = setup();
    const valid = sessionCookie();
    const forged = valid.slice(0, valid.indexOf('=') + 1) + 'forged';
    for (const cookie of [undefined, '', forged, sessionCookie(otherRound), sessionCookie(roundId, nowMs - 3_600_000)]) {
      expect((await handleVoteRequest(request(submit, cookie), options)).status).toBe(401);
      expect((await handleVoteRequest(request({ action: 'status', roundId }, cookie), options)).status).toBe(401);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects ambiguous and oversized cookies instead of choosing a caller-controlled identity', async () => {
    const { options, store } = setup();
    for (const cookie of [`${sessionCookie()}; ${sessionCookie()}`, '__Host-hawker-session', `__Host-hawker-session=${'a'.repeat(1025)}`, `other=${'a'.repeat(4096)}`]) {
      expect((await handleVoteRequest(request(submit, cookie), options)).status).toBe(400);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied session identities, clocks, effects and extra fields', async () => {
    const { options, store } = setup();
    for (const body of [null, [], { ...submit, sessionId: otherRound }, { ...submit, nowMs }, { ...submit, effect: 'rain' },
      { ...submit, optionId: 'arbitrary' }, { ...submit, requestId: 'bad' }, { action: 'status', roundId, requestId }, { action: 'session', roundId, sessionId: otherRound }]) {
      expect((await handleVoteRequest(request(body, sessionCookie()), options)).status).toBe(400);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('submits exactly once with the verified session identity and responds only after acknowledgement', async () => {
    const { options, submitVote, getVoteWindow } = setup();
    const issued = issueVoteSession({ key, roundId, nowMs });
    let resolve!: (value: typeof receipt) => void;
    submitVote.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let settled = false;
    const pending = handleVoteRequest(request(submit, `__Host-hawker-session=${issued.token}`), options).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(submitVote).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(submitVote).toHaveBeenCalledExactlyOnceWith({ roundId, requestId, optionId: 'rain', sessionId: issued.sessionId });
    resolve(receipt);
    expect(await (await pending).json()).toEqual({ receipt });
    expect(getVoteWindow).toHaveBeenCalledExactlyOnceWith(roundId);
  });
  it('looks up only the signed session receipt and never includes another voter identity', async () => {
    const { options, getVoteReceipt, submitVote } = setup();
    const issued = issueVoteSession({ key, roundId, nowMs });
    const result = await handleVoteRequest(request({ action: 'status', roundId }, `__Host-hawker-session=${issued.token}`), options);
    expect(getVoteReceipt).toHaveBeenCalledExactlyOnceWith({ roundId, sessionId: issued.sessionId });
    expect(await result.json()).toEqual({ window, receipt, result: null });
    expect(submitVote).not.toHaveBeenCalled();
  });
  it('returns the sanitized resolved result alongside the session receipt', async () => {
    const { options, getVoteResult } = setup();
    const resolved = { schemaVersion: 'live-vote-result-1' as const, round_id: roundId, winner: 'rain' as const, effective_tick: 35, ends_at: 44, counts: { bus: 0, rain: 1, 'supplier-delay': 0 }, applied: true };
    getVoteResult.mockResolvedValueOnce(resolved);
    const response = await handleVoteRequest(request({ action: 'status', roundId }, sessionCookie()), options);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ window, receipt, result: resolved });
    expect(getVoteResult).toHaveBeenCalledExactlyOnceWith(roundId);
  });
  it('does not read private receipts or submit when a previously visible window is withdrawn', async () => {
    const { options, getVoteWindow, getVoteReceipt, submitVote } = setup();
    getVoteWindow.mockResolvedValue(null);
    for (const body of [submit, { action: 'status', roundId }]) {
      expect((await handleVoteRequest(request(body, sessionCookie()), options)).status).toBe(404);
    }
    expect(getVoteReceipt).not.toHaveBeenCalled(); expect(submitVote).not.toHaveBeenCalled();
  });
  it('lets storage return an accepted retry after window closure instead of inventing a rejection', async () => {
    const { options, getVoteWindow, submitVote } = setup();
    getVoteWindow.mockResolvedValue({ ...window, status: 'locked', remaining_ms: 0, eligible_options: [] });
    submitVote.mockResolvedValue({ ...receipt, replayed: true });
    const result = await handleVoteRequest(request(submit, sessionCookie()), options);
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ receipt: { ...receipt, replayed: true } });
    expect(submitVote).toHaveBeenCalledOnce();
  });
  it('distinguishes conflicts and rate limits and never retries uncertain writes', async () => {
    const { options, submitVote } = setup();
    for (const status of [409, 429]) {
      submitVote.mockRejectedValueOnce(new LiveStoreError('http', status));
      expect((await handleVoteRequest(request(submit, sessionCookie()), options)).status).toBe(status);
    }
    submitVote.mockRejectedValueOnce(new Error(`secret ${key}`));
    const result = await handleVoteRequest(request(submit, sessionCookie()), options);
    expect(result.status).toBe(503); expect(await result.text()).not.toContain(key);
    expect(submitVote).toHaveBeenCalledTimes(3);
  });
  it('bounds declared and streamed bodies and rejects malformed UTF-8', async () => {
    const { options, store } = setup();
    expect((await handleVoteRequest(request(submit, sessionCookie(), { 'content-length': '1025' }), options)).status).toBe(413);
    for (const [bytes, status] of [[new Uint8Array(1025), 413], [new Uint8Array([255]), 400], [new TextEncoder().encode('{'), 400]] as const) {
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      const input = new Request(`${origin}/api/votes`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' });
      expect((await handleVoteRequest(input, options)).status).toBe(status);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('times out a stalled body without waiting for an uncooperative cancellation', async () => {
    vi.useFakeTimers();
    const { options, store } = setup();
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
    const input = new Request(`${origin}/api/votes`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body, duplex: 'half' } as RequestInit & { duplex: 'half' });
    const pending = handleVoteRequest(input, options);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await pending).status).toBe(408); expect(store).not.toHaveBeenCalled();
  });
});
