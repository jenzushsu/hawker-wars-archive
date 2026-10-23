import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const VOTE_SESSION_TTL_MS = 3_600_000;
const keySchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const time = z.number().int().safe().nonnegative().refine(value => !Object.is(value, -0));
const payloadSchema = z.object({ version: z.literal('vote-session-1'), sessionId: uuid, roundId: uuid,
  issuedAtMs: time, expiresAtMs: time }).strict();
export class VoteSessionError extends Error {
  constructor() { super('Invalid vote session configuration or input'); this.name = 'VoteSessionError'; }
}
function configuration(input: { key: string; roundId: string; nowMs: number }) {
  try { return z.object({ key: keySchema, roundId: uuid, nowMs: time.refine(value => value <= Number.MAX_SAFE_INTEGER - VOTE_SESSION_TTL_MS) }).parse(input); }
  catch { throw new VoteSessionError(); }
}
function signature(key: string, encoded: string): Buffer {
  return createHmac('sha256', key).update(`hawker-wars:vote-session-1:${encoded}`).digest();
}
/** Round-bound, signed anonymous exhibition identity; not proof of one human. */
export function issueVoteSession(input: { key: string; roundId: string; nowMs: number }): { token: string; sessionId: string; expiresAtMs: number } {
  const value = configuration(input);
  const payload = { version: 'vote-session-1', sessionId: randomUUID(), roundId: value.roundId,
    issuedAtMs: value.nowMs, expiresAtMs: value.nowMs + VOTE_SESSION_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { token: `${encoded}.${signature(value.key, encoded).toString('base64url')}`,
    sessionId: payload.sessionId, expiresAtMs: payload.expiresAtMs };
}
/** Invalid, expired, noncanonical or differently scoped cookies grant no identity. */
export function verifyVoteSession(input: { key: string; roundId: string; token: string; nowMs: number }): { sessionId: string; expiresAtMs: number } | null {
  const value = configuration(input);
  if (typeof input.token !== 'string' || input.token.length > 1024) return null;
  const match = /^([A-Za-z0-9_-]{1,900})\.([A-Za-z0-9_-]{43})$/.exec(input.token);
  if (!match) return null;
  const encoded = match[1]!, supplied = Buffer.from(match[2]!, 'base64url');
  if (supplied.length !== 32 || supplied.toString('base64url') !== match[2] ||
      !timingSafeEqual(supplied, signature(value.key, encoded))) return null;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) return null;
    const payload = payloadSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (payload.roundId !== value.roundId || payload.issuedAtMs > value.nowMs || payload.expiresAtMs <= value.nowMs ||
        payload.expiresAtMs - payload.issuedAtMs !== VOTE_SESSION_TTL_MS) return null;
    return { sessionId: payload.sessionId, expiresAtMs: payload.expiresAtMs };
  } catch { return null; }
}
