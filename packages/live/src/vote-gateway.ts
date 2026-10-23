import { z } from 'zod';
import { LiveStoreError, type LiveStore } from './store.ts';
import { issueVoteSession, verifyVoteSession } from './session.ts';

const COOKIE = '__Host-hawker-session';
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const bodySchema = z.union([
  z.object({ action: z.literal('session'), roundId: uuid }).strict(),
  z.object({ action: z.literal('status'), roundId: uuid }).strict(),
  z.object({ action: z.literal('submit'), roundId: uuid, requestId: uuid,
    optionId: z.enum(['bus', 'rain', 'supplier-delay']) }).strict(),
]);
export interface VoteGatewayOptions {
  signingKey?: string | undefined;
  origin?: string | undefined;
  store: () => Pick<LiveStore, 'getVoteWindow' | 'getVoteReceipt' | 'getVoteResult' | 'submitVote'>;
  now?: () => number;
}
class RequestError extends Error { constructor(readonly status: number) { super('Invalid vote request'); } }
function response(status: number, body: unknown, cookie?: string): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(cookie === undefined ? {} : { 'Set-Cookie': cookie }) } });
}
function configured(options: VoteGatewayOptions): boolean {
  if (!options.signingKey || !/^[A-Za-z0-9_-]{43,128}$/.test(options.signingKey) || !options.origin) return false;
  try { const url = new URL(options.origin); return url.protocol === 'https:' && url.origin === options.origin && !url.username && !url.password; }
  catch { return false; }
}
function cookieToken(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;
  if (header.length > 4096) throw new RequestError(400);
  const values: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (part.slice(0, separator < 0 ? undefined : separator).trim() !== COOKIE) continue;
    if (separator < 0) throw new RequestError(400);
    values.push(part.slice(separator + 1).trim());
  }
  if (values.length > 1 || (values[0]?.length ?? 0) > 1024) throw new RequestError(400);
  return values[0] ?? null;
}
async function readBody(request: Request): Promise<unknown> {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) throw new RequestError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new RequestError(408)), 2000); });
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 1024) throw new RequestError(413);
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError(400); }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

/** Same-origin anonymous exhibition sessions are deduplication identities, not proof
 * of one human per vote. Only durable server acknowledgements mean acceptance.
 */
export async function handleVoteRequest(request: Request, options: VoteGatewayOptions): Promise<Response> {
  if (request.method !== 'POST') return response(405, { error: 'method-not-allowed' });
  if (!configured(options)) return response(503, { error: 'voting-unavailable' });
  if (request.headers.get('origin') !== options.origin) return response(403, { error: 'origin-rejected' });
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '') || request.headers.has('content-encoding')) {
    return response(415, { error: 'unsupported-content-type' });
  }
  let input: z.infer<typeof bodySchema>, token: string | null;
  try { input = bodySchema.parse(await readBody(request)); token = cookieToken(request); }
  catch (error) { return response(error instanceof RequestError ? error.status : 400, { error: 'invalid-request' }); }
  try {
    const nowMs = (options.now ?? Date.now)();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || Object.is(nowMs, -0)) throw new Error();
    const key = options.signingKey!;
    const session = token === null ? null : verifyVoteSession({ key, roundId: input.roundId, token, nowMs });
    if (input.action !== 'session' && session === null) return response(401, { error: 'session-required' });
    const store = options.store();
    if (input.action === 'session') {
      const window = await store.getVoteWindow(input.roundId);
      if (window === null) return response(404, { error: 'window-not-found' });
      if (window.status === 'disabled' || (window.status !== 'open' && session === null)) return response(409, { error: 'window-closed' });
      const issued = session === null ? issueVoteSession({ key, roundId: input.roundId, nowMs }) : { ...session, token: token! };
      const maxAge = Math.max(0, Math.floor((issued.expiresAtMs - nowMs) / 1000));
      return response(200, { window }, `${COOKIE}=${issued.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
    }
    if (input.action === 'status') {
      const window = await store.getVoteWindow(input.roundId);
      if (window === null) return response(404, { error: 'window-not-found' });
      const [receipt, result] = await Promise.all([
        store.getVoteReceipt({ roundId: input.roundId, sessionId: session!.sessionId }),
        store.getVoteResult(input.roundId),
      ]);
      return response(200, { window, receipt, result });
    }
    // Publication may have been withdrawn after this session was signed. Keep the
    // public visibility boundary even for retries; the database owns eligibility.
    if (await store.getVoteWindow(input.roundId) === null) return response(404, { error: 'window-not-found' });
    const receipt = await store.submitVote({ roundId: input.roundId, sessionId: session!.sessionId,
      requestId: input.requestId, optionId: input.optionId });
    return response(200, { receipt });
  } catch (error) {
    if (error instanceof LiveStoreError && error.code === 'http') {
      if (error.status === 409) return response(409, { error: 'vote-conflict' });
      if (error.status === 429) return response(429, { error: 'vote-rate-limited' });
    }
    return response(503, { error: input.action === 'submit' ? 'vote-outcome-unconfirmed' : 'voting-unavailable',
      ...(input.action === 'submit' ? { instruction: 'Retry the identical request with the same requestId and session, then read status.' } : {}) });
  }
}
