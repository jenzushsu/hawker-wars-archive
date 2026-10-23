import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issueVoteSession, verifyVoteSession, VoteSessionError, VOTE_SESSION_TTL_MS } from '../packages/live/src/session.ts';

const key = 'session-test-only-signing-key-at-least-43-characters';
const roundId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const sessionId = '11111111-1111-4111-8111-111111111111';
const nowMs = 1_800_000_000_000;
const payload = { version: 'vote-session-1', sessionId, roundId, issuedAtMs: nowMs, expiresAtMs: nowMs + 3_600_000 };
function signEncoded(encoded: string, domain = 'hawker-wars:vote-session-1:'): string {
  return `${encoded}.${createHmac('sha256', key).update(`${domain}${encoded}`).digest('base64url')}`;
}
function sign(value: unknown): string { return signEncoded(Buffer.from(JSON.stringify(value)).toString('base64url')); }
function verify(token: string, overrides: Partial<{ key: string; roundId: string; nowMs: number }> = {}) {
  return verifyVoteSession({ key, roundId, nowMs, token, ...overrides });
}

describe('signed anonymous vote sessions', () => {
  it('issues distinct random identities bound to a canonical round and exact one-hour lifetime', () => {
    const first = issueVoteSession({ key, roundId: roundId.toUpperCase(), nowMs });
    const second = issueVoteSession({ key, roundId, nowMs });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(first.token).not.toBe(second.token);
    expect(first.expiresAtMs).toBe(nowMs + VOTE_SESSION_TTL_MS);
    expect(verify(first.token, { roundId: roundId.toUpperCase() })).toEqual({ sessionId: first.sessionId, expiresAtMs: first.expiresAtMs });
    const decoded = JSON.parse(Buffer.from(first.token.split('.')[0]!, 'base64url').toString());
    expect(decoded.roundId).toBe(roundId);
    expect(JSON.stringify(decoded)).not.toContain(key);
  });
  it('accepts an independently signed vector and rejects the exact expiry boundary', () => {
    const token = sign(payload);
    expect(verify(token)).toEqual({ sessionId, expiresAtMs: payload.expiresAtMs });
    expect(verify(token, { nowMs: payload.expiresAtMs - 1 })).not.toBeNull();
    expect(verify(token, { nowMs: payload.expiresAtMs })).toBeNull();
    expect(verify(token, { nowMs: nowMs - 1 })).toBeNull();
  });
  it('rejects tampered identity, changed signature, wrong keys, wrong rounds and wrong signing domains', () => {
    const token = sign(payload);
    const [encoded, signature] = token.split('.') as [string, string];
    const changed = Buffer.from(JSON.stringify({ ...payload, sessionId: roundId })).toString('base64url');
    expect(verify(`${changed}.${signature}`)).toBeNull();
    expect(verify(`${encoded}.${signature[0] === 'a' ? 'b' : 'a'}${signature.slice(1)}`)).toBeNull();
    expect(verify(token, { key: 'different-test-key-with-at-least-43-characters' })).toBeNull();
    expect(verify(token, { roundId: sessionId })).toBeNull();
    expect(verify(signEncoded(encoded, 'another-purpose:'))).toBeNull();
  });
  it('rejects signature aliases, padding and noncanonical encoded payloads even with valid HMACs', () => {
    const token = sign(payload);
    const [encoded, signature] = token.split('.') as [string, string];
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const alternate = signature.slice(0, -1) + alphabet[alphabet.indexOf(signature.at(-1)!) ^ 1];
    expect(Buffer.from(alternate, 'base64url')).toEqual(Buffer.from(signature, 'base64url'));
    expect(verify(`${encoded}.${alternate}`)).toBeNull();
    expect(verify(`${encoded}.${signature}=`)).toBeNull();
    expect(verify(`${encoded}=.${signature}`)).toBeNull();
    // e31 decodes to the same bytes as canonical e30 ({}), but has nonzero padding bits.
    expect(verify(signEncoded('e31'))).toBeNull();
  });
  it('rejects missing fields, extra claims, wrong versions, malformed IDs and unsafe timestamps', () => {
    for (const value of [null, [], {}, { ...payload, version: 'vote-session-2' }, { ...payload, actorId: 'operator' },
      { ...payload, sessionId: 'chosen-identity' }, { ...payload, roundId: 'invalid' }, { ...payload, issuedAtMs: '0' },
      { ...payload, issuedAtMs: -1 }, { ...payload, expiresAtMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...payload, issuedAtMs: 0.5 }, { ...payload, expiresAtMs: null }]) expect(verify(sign(value))).toBeNull();
  });
  it('rejects future-issued tokens and shortened or extended lifetimes despite authentic signatures', () => {
    for (const value of [
      { ...payload, issuedAtMs: nowMs + 1, expiresAtMs: payload.expiresAtMs + 1 },
      { ...payload, expiresAtMs: payload.expiresAtMs - 1 },
      { ...payload, expiresAtMs: payload.expiresAtMs + 1 },
      { ...payload, expiresAtMs: nowMs },
    ]) expect(verify(sign(value))).toBeNull();
  });
  it('rejects malformed, oversized and invalid UTF-8 tokens without throwing parser errors', () => {
    for (const token of ['', 'a', 'a.b', 'a'.repeat(1025), `${sign(payload)}.extra`, signEncoded('_w'), signEncoded(Buffer.from('{').toString('base64url'))]) {
      expect(verify(token)).toBeNull();
    }
    expect(verifyVoteSession({ key, roundId, nowMs, token: null as unknown as string })).toBeNull();
  });
  it('fails closed with sanitized errors for invalid configuration and overflowing clocks', () => {
    for (const patch of [{ key: '' }, { key: 'private-invalid key' }, { key: 'x'.repeat(129) }, { roundId: 'private-invalid-round' },
      { nowMs: -1 }, { nowMs: -0 }, { nowMs: 0.5 }, { nowMs: NaN }, { nowMs: Infinity },
      { nowMs: Number.MAX_SAFE_INTEGER - VOTE_SESSION_TTL_MS + 1 }]) {
      expect(() => issueVoteSession({ key, roundId, nowMs, ...patch })).toThrow(VoteSessionError);
      expect(() => verifyVoteSession({ key, roundId, nowMs, token: sign(payload), ...patch })).toThrow('Invalid vote session configuration or input');
    }
    const boundary = issueVoteSession({ key, roundId, nowMs: Number.MAX_SAFE_INTEGER - VOTE_SESSION_TTL_MS });
    expect(boundary.expiresAtMs).toBe(Number.MAX_SAFE_INTEGER);
  });
});
