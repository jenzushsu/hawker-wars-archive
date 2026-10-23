import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { LiveStoreError, type LiveStore } from './store.ts';

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const bodySchema = z.union([
  z.object({ action: z.enum(['pause', 'resume', 'stop']), roundId: uuid, requestId: uuid,
    expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1).refine(value => !Object.is(value, -0)),
  }).strict(),
  z.object({ action: z.literal('status'), roundId: uuid }).strict(),
]);
const MAX_BODY_BYTES = 1024;
const BODY_TIMEOUT_MS = 2000;
type OperatorStore = Pick<LiveStore, 'controlRound' | 'getRoundStatus'>;
export interface OperatorOptions {
  token?: string | undefined;
  actorId?: string | undefined;
  store: () => OperatorStore;
}
class BodyError extends Error { constructor(readonly status: number) { super('Invalid operator request'); } }
function response(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
function digest(value: string): Buffer { return createHash('sha256').update(value).digest(); }
async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new BodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new BodyError(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BodyError(408)), BODY_TIMEOUT_MS); });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new BodyError(413);
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof BodyError) throw error;
    throw new BodyError(400);
  } finally {
    clearTimeout(timer);
    // Do not let an uncooperative request stream extend the request deadline.
    void reader.cancel().catch(() => {});
  }
}

/** Machine-to-machine operator endpoint. A dedicated bearer credential authorizes
 * only the configured server actor; cookies and browser origins grant no authority.
 * No inference, background work, automatic retries or client-selected actor IDs.
 */
export async function handleOperatorRequest(request: Request, options: OperatorOptions): Promise<Response> {
  if (request.method !== 'POST') return response(405, { error: 'method-not-allowed' });
  if (!options.token || !/^[A-Za-z0-9_-]{43,128}$/.test(options.token) ||
      !options.actorId || !/^[A-Za-z0-9_-]{1,128}$/.test(options.actorId)) {
    return response(503, { error: 'operator-unavailable' });
  }
  const authorization = request.headers.get('authorization');
  const supplied = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  if (!supplied || !timingSafeEqual(digest(supplied), digest(options.token))) return response(401, { error: 'unauthorized' });
  if (request.headers.has('origin')) return response(403, { error: 'browser-origin-not-supported' });
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') ||
      request.headers.has('content-encoding')) return response(415, { error: 'unsupported-content-type' });
  let input: z.infer<typeof bodySchema>;
  try { input = bodySchema.parse(await readBody(request)); }
  catch (error) { return response(error instanceof BodyError ? error.status : 400, { error: 'invalid-request' }); }
  try {
    const store = options.store();
    if (input.action === 'status') {
      const status = await store.getRoundStatus(input.roundId);
      return status === null ? response(404, { error: 'round-not-found' }) : response(200, status);
    }
    const result = await store.controlRound({ ...input, actorId: options.actorId });
    return response(200, result);
  } catch (error) {
    if (error instanceof LiveStoreError && error.code === 'http' && error.status === 409) {
      return response(409, { error: 'control-conflict' });
    }
    // The database may have committed even if transport or response validation failed.
    // The caller must reuse the same request identity, then inspect current status.
    return response(503, { error: 'control-outcome-unconfirmed', instruction: 'Retry the identical request with the same requestId, then read status.' });
  }
}
