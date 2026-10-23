import type { z } from 'zod';
import type { ActionSchema, ChaosEventSchema, CustomerSchema, SimulatorState } from '../../shared/src/index.js';

export type Action = z.infer<typeof ActionSchema>;
export type ChaosEventType = z.infer<typeof ChaosEventSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export interface ExternalEvent {
  id: string;
  type: ChaosEventType;
  effectiveTick: number;
  /** Inclusive; inferred from demand-1 when omitted. */
  endsAt?: number;
}
export interface OpeningLedger {
  /** Initial cash before sales/purchases/promotions represented by state totals. */
  openingCashCents: number;
  /** Initial raw + ready stock before acquisitions represented by state totals. */
  openingPortions: number;
}
export type ResolutionOutcome = 'served' | 'queue_full' | 'patience_expired' | 'closing_unserved';
export interface CustomerResolution {
  type: 'customer-resolved';
  tick: number;
  customerId: string;
  arrivalTick: number;
  waitMinutes: number;
  outcome: ResolutionOutcome;
}
export type EngineEvent = CustomerResolution
  | { type: 'ready-wasted'; tick: number; quantity: number; reason: 'expiry' | 'closing' }
  | { type: 'cooking-completed'; tick: number; quantity: number; batchId: string }
  | { type: 'restock-delivered'; tick: number; quantity: number }
  | { type: 'action-applied'; tick: number; action: Action }
  | { type: 'effect-applied'; tick: number; eventId: string; effectType: ChaosEventType }
  | { type: 'closed'; tick: 120 };
export type EngineStage = 'before-tick' | 'decision' | 'committed' | 'closed';
/** Cursor metadata is deterministic, not a hidden switch disabling production validation. */
export interface EngineFrame {
  stage: EngineStage;
  boundaryTick: number;
  state: SimulatorState;
  ledger: OpeningLedger;
  appliedEvents: ExternalEvent[];
  seenCustomerIds: string[];
  /** Events produced by this operation only; the caller may accumulate a trace. */
  events: EngineEvent[];
}
export interface TickInput {
  /** Already-resolved potential arrivals for this policy; ordered by source/ordinal. */
  arrivals?: readonly Customer[];
  event?: ExternalEvent;
}
