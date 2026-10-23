import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleOperatorRequest } from '../packages/live/src/operator.ts';
import { LiveStoreError, type LiveStore } from '../packages/live/src/store.ts';

const token = 'operator-test-only-token-32-bytes-minimum-1234567890';
const actorId = 'local-operator-test';
const roundId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const command = { roundId, requestId, action: 'pause' as const, expectedRevision: 0 };
const receipt = { schemaVersion: 'live-control-1' as const, round_id: roundId, request_id: requestId,
  action: 'pause' as const, control_state: 'paused' as const, control_revision: 1, tick: 3, sequence: 4, replayed: false };
const status = { schemaVersion: 'live-round-status-1' as const, round_id: roundId, classification: 'exhibition' as const,
  policy_ids: ['rules' as const], status: 'running' as const, control_state: 'paused' as const, control_revision: 1,
  tick: 3, sequence: 4, configuration_hash: 'a'.repeat(64), schedule_hash: 'b'.repeat(64), ready: false };
function setup() {
  const controlRound = vi.fn<LiveStore['controlRound']>().mockResolvedValue(receipt);
  const getRoundStatus = vi.fn<LiveStore['getRoundStatus']>().mockResolvedValue(status);
  const store = vi.fn(() => ({ controlRound, getRoundStatus }));
  return { controlRound, getRoundStatus, store, options: { token, actorId, store } };
}
function request(body: unknown = command, headers: Record<string, string> = {}) {
  return new Request('https://app.example/api/admin/rounds/control', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function streamed(stream: ReadableStream<Uint8Array>) {
  return new Request('https://app.example/api/admin/rounds/control', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: stream, duplex: 'half',
  } as RequestInit & { duplex: 'half' });
}

afterEach(() => { vi.useRealTimers(); });
describe('operator gateway authentication and bounded requests', () => {
  it('fails closed without complete server configuration before constructing a backend', async () => {
    const { options, store } = setup();
    for (const bad of [{ token: '' }, { token: 'short' }, { token: ' '.repeat(44) }, { token: 'a'.repeat(129) }, { actorId: '' }, { actorId: 'client supplied identity' }, { actorId: 'a'.repeat(129) }]) {
      const response = await handleOperatorRequest(request(), { ...options, ...bad });
      expect(response.status).toBe(503);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects missing, wrong, malformed, cookie-only and duplicate bearer authorization before backend access', async () => {
    const { options, store } = setup();
    for (const authorization of ['', 'Bearer wrong', `Basic ${token}`, `Bearer ${token}, Bearer ${token}`, `Bearer ${token}extra`, `Bearer ${token}\tother`]) {
      const response = await handleOperatorRequest(request(command, { authorization, cookie: `operator=${token}` }), options);
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(token);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects browser-origin requests even with a valid token and provides no CORS grant', async () => {
    const { options, store } = setup();
    for (const origin of ['https://evil.example', 'https://app.example', 'null', '']) {
      const response = await handleOperatorRequest(request(command, { origin }), options);
      expect(response.status).toBe(403);
      expect(response.headers.has('access-control-allow-origin')).toBe(false);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('accepts POST only and never invokes a store for a read-method mutation', async () => {
    const { options, store } = setup();
    const response = await handleOperatorRequest(new Request('https://app.example/api/admin/rounds/control', {
      method: 'GET', headers: { authorization: `Bearer ${token}` },
    }), options);
    expect(response.status).toBe(405);
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects unsupported body media types and content encodings before backend access', async () => {
    const { options, store } = setup();
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'application/json; charset=latin1']) {
      expect((await handleOperatorRequest(request(command, { 'content-type': contentType }), options)).status).toBe(415);
    }
    expect((await handleOperatorRequest(request(command, { 'content-encoding': 'gzip' }), options)).status).toBe(415);
    expect(store).not.toHaveBeenCalled();
  });
  it('validates a closed command schema and forbids caller-controlled identity, time or effects', async () => {
    const { options, store } = setup();
    for (const body of [null, [], { ...command, actorId: 'forged' }, { ...command, nowMs: 0 }, { ...command, effect: 'rain' },
      { ...command, action: 'start' }, { ...command, action: 'restart' }, { ...command, roundId: 'not-uuid' },
      { ...command, requestId: roundId.slice(1) }, { ...command, expectedRevision: -1 }, { ...command, expectedRevision: 0.5 },
      { ...command, expectedRevision: Number.MAX_SAFE_INTEGER }, { ...command, expectedRevision: '0' },
      { action: 'status', roundId, requestId }, { action: 'status', roundId, actorId }, { action: 'status' }]) {
      expect((await handleOperatorRequest(request(body), options)).status).toBe(400);
    }
    expect(store).not.toHaveBeenCalled();
  });
  it('passes only a validated command plus server-owned actor identity and never caches receipts', async () => {
    const { options, store, controlRound, getRoundStatus } = setup();
    const response = await handleOperatorRequest(request(), options);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(receipt);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(controlRound).toHaveBeenCalledExactlyOnceWith({ ...command, actorId });
    expect(store).toHaveBeenCalledTimes(1);
    expect(getRoundStatus).not.toHaveBeenCalled();
  });
  it('accepts streamed JSON and canonicalizes UUIDs before invoking trusted storage', async () => {
    const { options, controlRound } = setup();
    const upperRound = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
    const upperRequest = 'BCDEFABC-DEFA-4BCD-8EFA-BCDEFABCDEFA';
    const value = { ...command, roundId: upperRound, requestId: upperRequest };
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();
    } });
    expect((await handleOperatorRequest(streamed(body), options)).status).toBe(200);
    expect(controlRound).toHaveBeenCalledExactlyOnceWith({ ...value, roundId: upperRound.toLowerCase(), requestId: upperRequest.toLowerCase(), actorId });
  });
  it('reads authoritative status only for an authenticated operator and has no mutation side effect', async () => {
    const { options, controlRound, getRoundStatus } = setup();
    const response = await handleOperatorRequest(request({ action: 'status', roundId }), options);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ round_id: roundId, control_state: 'paused', control_revision: 1, tick: 3, sequence: 4 });
    expect(getRoundStatus).toHaveBeenCalledExactlyOnceWith(roundId);
    expect(controlRound).not.toHaveBeenCalled();
    getRoundStatus.mockResolvedValueOnce(null);
    expect((await handleOperatorRequest(request({ action: 'status', roundId }), options)).status).toBe(404);
  });
  it('bounds both declared and streamed bytes without trusting content-length', async () => {
    const { options, store } = setup();
    expect((await handleOperatorRequest(request(command, { 'content-length': '1025' }), options)).status).toBe(413);
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1025)); controller.close(); } });
    expect((await handleOperatorRequest(streamed(body), options)).status).toBe(413);
    expect(store).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON, malformed UTF-8 and errored streams without backend access', async () => {
    const { options, store } = setup();
    for (const bytes of [new TextEncoder().encode('{'), new Uint8Array([0xff])]) {
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
      expect((await handleOperatorRequest(streamed(body), options)).status).toBe(400);
    }
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private-stream-error')); } });
    const response = await handleOperatorRequest(streamed(body), options);
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-stream-error');
    expect(store).not.toHaveBeenCalled();
  });
  it('ends a stalled body read at its deadline without waiting for stream cancellation', async () => {
    vi.useFakeTimers();
    const { options, store } = setup();
    const body = new ReadableStream<Uint8Array>({ cancel: () => new Promise(() => {}) });
    const response = handleOperatorRequest(streamed(body), options);
    await vi.advanceTimersByTimeAsync(2001);
    expect((await response).status).toBe(408);
    expect(store).not.toHaveBeenCalled();
  });
  it('does not retry uncertain mutations and sanitizes backend failures', async () => {
    const { options, controlRound } = setup();
    controlRound.mockRejectedValueOnce(new LiveStoreError('transport'));
    const response = await handleOperatorRequest(request(), options);
    expect(response.status).toBe(503);
    expect(controlRound).toHaveBeenCalledTimes(1);
    controlRound.mockRejectedValueOnce(new Error(`private ${token} database detail`));
    const unexpected = await handleOperatorRequest(request(), options);
    expect(unexpected.status).toBe(503);
    expect(await unexpected.text()).not.toContain(token);
    expect(controlRound).toHaveBeenCalledTimes(2);
  });
  it('reports optimistic-concurrency conflicts distinctly without retrying', async () => {
    const { options, controlRound } = setup();
    controlRound.mockRejectedValueOnce(new LiveStoreError('http', 409));
    expect((await handleOperatorRequest(request(), options)).status).toBe(409);
    expect(controlRound).toHaveBeenCalledTimes(1);
  });
});
