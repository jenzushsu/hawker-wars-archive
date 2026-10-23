import { CHAOS_EVENTS, DEMAND_CONFIG, POC_CONFIG } from '../../shared/src/config.ts';
import { RunManifestSchema, type RunManifest } from '../../shared/src/schemas.ts';
import { keyedDraw, type KeyedDraw } from '../../simulation/src/demand.ts';

export type VoteOption = (typeof CHAOS_EVENTS)[number];
export type VoteClassification = RunManifest['classification'];
export type VoteStatus = 'closed' | 'open' | 'locked' | 'resolved' | 'scheduled' | 'active' | 'expired';
export type VoteCounts = Readonly<Record<VoteOption, number>>;
export interface VoteReceipt { readonly requestId: string; readonly optionId: VoteOption; readonly acceptedAt: number }
export interface VoteSubmission { readonly sessionId: string; readonly requestId: string; readonly optionId: VoteOption }
export interface VoteEffect { readonly id: string; readonly type: VoteOption; readonly effectiveTick: number; readonly endsAt: number }
export interface VoteResolution { readonly counts: VoteCounts; readonly winner: VoteOption | null; readonly tiedOptions: readonly VoteOption[]; readonly draw: KeyedDraw | null }
export interface PublicVoteWindow {
  readonly schemaVersion: 'vote-window-1'; readonly roundId: string; readonly windowId: string;
  readonly status: VoteStatus; readonly committedTick: number; readonly enabled: boolean; readonly paused: boolean;
  readonly eligibleOptions: readonly VoteOption[]; readonly deadlineMs: number | null; readonly remainingMs: number;
  readonly counts: VoteCounts; readonly winningOption: VoteOption | null; readonly effect: VoteEffect | null;
}
export class VotingError extends Error { constructor(code: string) { super(`Voting rejected: ${code}`); this.name = 'VotingError'; } }
function reject(code: string): never { throw new VotingError(code); }
function integer(value: number, name: string): void { if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) reject(name); }
function id(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) reject('identifier'); }
function plus(a: number, b: number): number { const value = a + b; integer(value, 'clock-overflow'); return value; }
const emptyCounts = (): Record<VoteOption, number> => ({ bus: 0, rain: 0, 'supplier-delay': 0 });

/** Trusted worker core only. Caller must authenticate sessions, serialize durable transactions,
 * fence workers and rate-limit before using this object. No network, persistence or engine writes.
 * Clean exhibition precondition: caller must reject rounds with any preexisting chaos event.
 * This core schedules at most one event and does not inspect an engine or schedule.
 * nowMs is monotonic server time; accepted receipts contain no authentication identity.
 */
export class VotingRound {
  readonly #roundId: string;
  readonly #classification: VoteClassification;
  readonly #seed: number;
  #tick = -1;
  #now = 0;
  #status: VoteStatus = 'closed';
  #enabled = true;
  #paused = false;
  #deadline: number | null = null;
  #remaining = 0;
  #opened = false;
  #votes = new Map<string, VoteReceipt>();
  #requests = new Map<string, Map<string, VoteReceipt>>();
  #resolution: VoteResolution | null = null;
  #effect: VoteEffect | null = null;

  constructor(input: { roundId: string; classification: VoteClassification; seed: number }) {
    id(input.roundId); integer(input.seed, 'seed');
    if (!RunManifestSchema.innerType().shape.classification.safeParse(input.classification).success) reject('classification');
    this.#roundId = input.roundId; this.#classification = input.classification; this.#seed = input.seed;
    this.#enabled = input.classification === 'exhibition';
  }
  #clock(nowMs: number): void {
    integer(nowMs, 'time'); if (nowMs < this.#now) reject('time-regression');
    this.#now = nowMs;
    if (this.#status === 'open' && !this.#paused && this.#deadline !== null && nowMs >= this.#deadline) {
      this.#status = 'locked'; this.#remaining = 0;
    }
  }
  #exhibition(): void { if (this.#classification !== 'exhibition') reject('benchmark'); }
  #counts(): VoteCounts {
    const counts = emptyCounts(); for (const vote of this.#votes.values()) counts[vote.optionId]++;
    return Object.freeze(counts);
  }
  /** Mirror each committed tick, exactly once and in order. Invoke within the worker transaction
   * before publishing or advancing the durable round; a rejection must abort that transaction. */
  commitTick(tick: number, nowMs: number): void {
    integer(tick, 'tick'); if (tick > POC_CONFIG.closingTick || tick !== this.#tick + 1) reject('tick-order');
    if (this.#paused) reject('paused');
    // Preflight overflow before advancing the committed boundary.
    if (tick === DEMAND_CONFIG.voteOpensAfterTick && this.#enabled && !this.#opened) plus(nowMs, DEMAND_CONFIG.voteWindowMs);
    this.#clock(nowMs);
    if (this.#enabled && (this.#status === 'locked' || this.#status === 'resolved')) reject('unresolved-vote');
    this.#tick = tick;
    if (tick === DEMAND_CONFIG.voteOpensAfterTick && this.#enabled && !this.#opened) {
      this.#opened = true; this.#status = 'open'; this.#deadline = plus(nowMs, DEMAND_CONFIG.voteWindowMs); this.#remaining = DEMAND_CONFIG.voteWindowMs;
    }
    if (this.#effect !== null) {
      if (tick >= this.#effect.effectiveTick && tick <= this.#effect.endsAt && tick < POC_CONFIG.closingTick) this.#status = 'active';
      if (tick > this.#effect.endsAt || tick === POC_CONFIG.closingTick) this.#status = 'expired';
    } else if (tick === POC_CONFIG.closingTick) { this.#status = 'expired'; this.#deadline = null; this.#remaining = 0; }
  }
  submit(input: VoteSubmission, nowMs: number): VoteReceipt {
    this.#exhibition(); id(input.sessionId); id(input.requestId);
    if (!(CHAOS_EVENTS as readonly string[]).includes(input.optionId)) reject('option');
    this.#clock(nowMs);
    const prior = this.#requests.get(input.sessionId)?.get(input.requestId);
    if (prior) { if (prior.optionId !== input.optionId) reject('request-conflict'); return prior; }
    if (!this.#enabled || this.#status !== 'open') reject('closed');
    if (this.#paused) reject('paused');
    const receipt = Object.freeze({ requestId: input.requestId, optionId: input.optionId, acceptedAt: nowMs });
    const requests = this.#requests.get(input.sessionId) ?? new Map<string, VoteReceipt>();
    requests.set(input.requestId, receipt); this.#requests.set(input.sessionId, requests); this.#votes.set(input.sessionId, receipt);
    return receipt;
  }
  /** Session-specific private lookup; authenticate the caller before using it. */
  receipt(sessionId: string): VoteReceipt | null { id(sessionId); return this.#votes.get(sessionId) ?? null; }
  pause(nowMs: number): void {
    this.#clock(nowMs); if (this.#paused) return;
    if (this.#status === 'open') { this.#remaining = this.#deadline! - nowMs; this.#deadline = null; }
    this.#paused = true;
  }
  resume(nowMs: number): void {
    integer(nowMs, 'time'); if (nowMs < this.#now) reject('time-regression');
    const deadline = this.#paused && this.#status === 'open' ? plus(nowMs, this.#remaining) : this.#deadline;
    this.#clock(nowMs); if (!this.#paused) return;
    this.#deadline = deadline; this.#paused = false;
  }
  /** Irreversible for this round. Scheduled/active/expired effects are never undone. */
  disable(nowMs: number): void {
    this.#clock(nowMs); this.#enabled = false;
    if (['closed', 'open', 'locked', 'resolved'].includes(this.#status)) {
      this.#status = 'closed'; this.#deadline = null; this.#remaining = 0;
    }
  }
  /** Private audit record includes the tie draw. Never send this record to viewers. */
  resolve(nowMs: number): VoteResolution {
    this.#exhibition(); this.#clock(nowMs);
    if (this.#resolution !== null) return this.#resolution;
    if (this.#paused) reject('paused');
    if (!this.#enabled || this.#status !== 'locked') reject('not-locked');
    const counts = this.#counts(); const maximum = Math.max(...Object.values(counts));
    const tiedOptions = Object.freeze(maximum === 0 ? [] : CHAOS_EVENTS.filter(option => counts[option] === maximum).sort());
    const draw = tiedOptions.length > 1 ? keyedDraw(this.#seed, 'vote_tie', 0, 0) : null;
    const winner = tiedOptions.length === 0 ? null : tiedOptions[draw === null ? 0 : Math.floor(draw.u * tiedOptions.length)]!;
    this.#resolution = Object.freeze({ counts, winner, tiedOptions, draw }); this.#status = 'resolved';
    return this.#resolution;
  }
  /** Returns an engine-compatible scheduled event; caller must commit it atomically to every policy. */
  schedule(nowMs: number): VoteEffect | null {
    this.#exhibition(); this.#clock(nowMs);
    if (this.#effect !== null) return this.#effect;
    if (this.#status === 'expired' && this.#resolution?.winner === null) return null;
    if (this.#paused) reject('paused');
    if (!this.#enabled || this.#status !== 'resolved' || this.#resolution === null) reject('not-resolved');
    if (this.#resolution.winner === null) { this.#status = 'expired'; return null; }
    if (this.#tick + 1 >= POC_CONFIG.closingTick) reject('closing');
    const effectiveTick = this.#tick + 1;
    this.#effect = Object.freeze({ id: `vote:${this.#roundId}:0`, type: this.#resolution.winner, effectiveTick,
      endsAt: effectiveTick + (this.#resolution.winner === 'bus' ? 0 : 9) });
    this.#status = 'scheduled'; return this.#effect;
  }
  /** A sanitized public projection. Reads may lock an elapsed deadline, never open a window. */
  snapshot(nowMs: number): PublicVoteWindow {
    this.#clock(nowMs);
    return Object.freeze({ schemaVersion: 'vote-window-1', roundId: this.#roundId, windowId: `${this.#roundId}:0`,
      status: this.#status, committedTick: this.#tick, enabled: this.#enabled, paused: this.#paused,
      eligibleOptions: Object.freeze(this.#enabled && !this.#paused && this.#status === 'open' ? [...CHAOS_EVENTS] : []),
      deadlineMs: this.#deadline, remainingMs: this.#status === 'open' ? (this.#paused ? this.#remaining : Math.max(0, this.#deadline! - nowMs)) : 0,
      counts: this.#counts(), winningOption: this.#resolution?.winner ?? null, effect: this.#effect });
  }
}
