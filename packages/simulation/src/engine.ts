import {
  ActionSchema, CustomerSchema, EffectSchema, FixtureStateSchema, IdentifierSchema,
  POC_CONFIG, SimulatorStateSchema, type SimulatorState,
} from '../../shared/src/index.js';
import { effectiveRestockDueTick, getLegalActions, readyPortions } from './legality.js';
import type { Action, Customer, EngineEvent, EngineFrame, ExternalEvent, OpeningLedger, TickInput } from './types.js';

function clone<T>(value: T): T { return structuredClone(value); }
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(child => freezeDeep(child));
    Object.freeze(value);
  }
  return value;
}
const demandSourceOrder = ['base', 'bus', 'promotion'];
function compareCustomers(a: Customer, b: Customer): number {
  if (a.arrivalTick !== b.arrivalTick) return a.arrivalTick - b.arrivalTick;
  const pa = /^customer-\d+-(base|bus|promotion)-(\d+)$/.exec(a.id);
  const pb = /^customer-\d+-(base|bus|promotion)-(\d+)$/.exec(b.id);
  if (pa && pb) return demandSourceOrder.indexOf(pa[1]!) - demandSourceOrder.indexOf(pb[1]!) || Number(pa[2]) - Number(pb[2]);
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
function safeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error(`Invalid integer ${name}`);
}
/** Every frame, including synthetic test frames, preserves its explicit opening ledger. */
export function assertFrame(frame: EngineFrame): void {
  if (!['before-tick', 'decision', 'committed', 'closed'].includes(frame.stage)) throw new Error('Invalid engine stage');
  const state = FixtureStateSchema.parse(frame.state);
  safeInteger(frame.boundaryTick, 'boundaryTick');
  if (frame.boundaryTick !== state.tick || frame.boundaryTick < 0 || frame.boundaryTick > 120) throw new Error('Frame tick mismatch');
  if (frame.stage === 'decision' && (state.phase !== 'decision' || state.tick === 120)) throw new Error('Decision phase mismatch');
  if (frame.stage === 'committed' && (state.phase !== 'committed' || state.tick === 120)) throw new Error('Committed phase mismatch');
  if (frame.stage === 'closed' && (state.phase !== 'closed' || state.tick !== 120)) throw new Error('Closing phase mismatch');
  if (frame.stage === 'before-tick' && state.phase !== 'committed') throw new Error('Pre-tick phase mismatch');
  safeInteger(frame.ledger.openingCashCents, 'openingCashCents');
  safeInteger(frame.ledger.openingPortions, 'openingPortions');
  if (frame.ledger.openingCashCents < 0 || frame.ledger.openingPortions < 0) throw new Error('Opening ledger cannot be negative');
  const portions = state.rawPortions + readyPortions(state) + (state.cooking?.quantity ?? 0) + (state.pendingRestock?.quantity ?? 0) + state.totals.served + state.totals.wasted;
  if (frame.ledger.openingPortions + state.totals.purchasedPortions !== portions) throw new Error('Opening portion ledger mismatch');
  if (frame.ledger.openingCashCents + state.totals.served * 500 - state.totals.restockOrders * 4000 - state.totals.promotions * 500 !== state.cashCents) throw new Error('Opening cash ledger mismatch');
  if (new Set(frame.appliedEvents.map(e => e.id)).size !== frame.appliedEvents.length || frame.appliedEvents.length > 1) throw new Error('At most one unique chaos event per episode');
  if (new Set(frame.seenCustomerIds).size !== frame.seenCustomerIds.length) throw new Error('Duplicate seen customer');
  if (state.queue.some(c => !frame.seenCustomerIds.includes(c.id))) throw new Error('Queued customer absent from seen IDs');
  // A real production opening cannot relax the standard identities.
  if (frame.ledger.openingCashCents === POC_CONFIG.initialCashCents && frame.ledger.openingPortions === 42 && frame.stage !== 'before-tick') SimulatorStateSchema.parse(state);
}
function finish(frame: EngineFrame): EngineFrame { assertFrame(frame); return freezeDeep(frame); }
function working(frame: EngineFrame): EngineFrame { assertFrame(frame); const copy = clone(frame); copy.events = []; return copy; }
function requireStage(frame: EngineFrame, stage: EngineFrame['stage']): void {
  if (frame.stage !== stage) throw new Error(`Expected ${stage}, got ${frame.stage}`);
}
export function createInitialFrame(): EngineFrame {
  const ledger: OpeningLedger = { openingCashCents: 20000, openingPortions: 42 };
  const state: SimulatorState = {
    tick: 0, phase: 'committed', cashCents: 20000, rawPortions: 30,
    readyBatches: [{ id: 'batch-0', quantity: 12, expiresAt: 20 }],
    cooking: null, pendingRestock: null, promotion: null, promotionEligibleAt: 0, queue: [], effects: [],
    totals: { served: 0, abandoned: 0, wasted: 0, waitMinutes: 0, arrivals: 0, purchasedPortions: 0, restockOrders: 0, promotions: 0 },
  };
  return finish({ stage: 'before-tick', boundaryTick: 0, state, ledger, appliedEvents: [], seenCustomerIds: [], events: [] });
}
function normalizeEvent(event: ExternalEvent): Required<ExternalEvent> {
  IdentifierSchema.parse(event.id);
  const endsAt = event.effectiveTick + (event.type === 'bus' ? 0 : 9);
  EffectSchema.parse({ type: event.type, startsAt: event.effectiveTick, endsAt: event.endsAt ?? endsAt });
  if (event.endsAt !== undefined && event.endsAt !== endsAt) throw new Error('Wrong external event duration');
  return { id: event.id, type: event.type, effectiveTick: event.effectiveTick, endsAt };
}
function applyEventInPlace(frame: EngineFrame, event: ExternalEvent): void {
  const normalized = normalizeEvent(event);
  const previous = frame.appliedEvents.find(e => e.id === normalized.id);
  if (previous) {
    if (JSON.stringify(normalizeEvent(previous)) !== JSON.stringify(normalized)) throw new Error('Event ID reused with changed payload');
    return;
  }
  if (frame.appliedEvents.length > 0) throw new Error('Only one external event per poc-1 episode');
  if (normalized.effectiveTick !== frame.boundaryTick || frame.boundaryTick >= 120) throw new Error('Event must apply at the current active tick');
  frame.appliedEvents.push(normalized);
  frame.state.effects = [{ type: normalized.type, startsAt: normalized.effectiveTick, endsAt: normalized.endsAt }];
  if (normalized.type === 'supplier-delay' && frame.state.pendingRestock && !frame.state.pendingRestock.delayApplied) {
    frame.state.pendingRestock.dueTick = Math.min(119, frame.state.pendingRestock.dueTick + 5);
    frame.state.pendingRestock.delayApplied = true;
  }
  frame.events.push({ type: 'effect-applied', tick: frame.boundaryTick, eventId: normalized.id, effectType: normalized.type });
}
export function applyExternalEvent(frame: EngineFrame, event: ExternalEvent): EngineFrame {
  requireStage(frame, 'before-tick');
  const result = working(frame); applyEventInPlace(result, event); return finish(result);
}
function resolveCustomer(frame: EngineFrame, customer: Customer, outcome: 'served' | 'queue_full' | 'patience_expired' | 'closing_unserved'): void {
  const waitMinutes = frame.boundaryTick - customer.arrivalTick;
  if (waitMinutes < 0) throw new Error('Cannot resolve a future customer');
  frame.state.totals.waitMinutes += waitMinutes;
  if (outcome === 'served') frame.state.totals.served += 1;
  else frame.state.totals.abandoned += 1;
  frame.events.push({ type: 'customer-resolved', tick: frame.boundaryTick, customerId: customer.id, arrivalTick: customer.arrivalTick, waitMinutes, outcome });
}
export function prepareTick(frame: EngineFrame, input: TickInput = {}): EngineFrame {
  requireStage(frame, 'before-tick');
  if (frame.boundaryTick >= 120) throw new Error('Closing has no arrivals or decision preparation');
  const result = working(frame), state = result.state, tick = result.boundaryTick;
  state.effects = state.effects.filter(effect => effect.endsAt >= tick);
  if (input.event) applyEventInPlace(result, input.event);
  const expired = state.readyBatches.filter(batch => batch.expiresAt <= tick).reduce((sum, batch) => sum + batch.quantity, 0);
  state.readyBatches = state.readyBatches.filter(batch => batch.expiresAt > tick);
  if (expired > 0) { state.totals.wasted += expired; result.events.push({ type: 'ready-wasted', tick, quantity: expired, reason: 'expiry' }); }
  if (state.pendingRestock && state.pendingRestock.dueTick <= tick) {
    const quantity = state.pendingRestock.quantity; state.rawPortions += quantity; state.pendingRestock = null;
    result.events.push({ type: 'restock-delivered', tick, quantity });
  }
  if (state.cooking && state.cooking.dueTick <= tick) {
    const quantity = state.cooking.quantity; const batchId = `batch-${tick}`;
    if (state.readyBatches.some(batch => batch.id === batchId)) throw new Error('Duplicate cooked batch ID');
    state.readyBatches.push({ id: batchId, quantity, expiresAt: tick + 20 }); state.cooking = null;
    result.events.push({ type: 'cooking-completed', tick, quantity, batchId });
  }
  state.readyBatches.sort((a, b) => a.expiresAt - b.expiresAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (state.promotion && state.promotion.endsAt < tick) state.promotion = null;
  const arrivals = (input.arrivals ?? []).map(customer => CustomerSchema.parse(customer));
  if (arrivals.some(customer => customer.arrivalTick !== tick)) throw new Error('Arrivals must belong to this tick');
  if (new Set(arrivals.map(c => c.id)).size !== arrivals.length || arrivals.some(c => result.seenCustomerIds.includes(c.id))) throw new Error('Duplicate arrival');
  for (const customer of [...arrivals].sort(compareCustomers)) {
    state.totals.arrivals += 1; result.seenCustomerIds.push(customer.id);
    if (state.queue.length < 30) state.queue.push(customer);
    else resolveCustomer(result, customer, 'queue_full');
  }
  const remaining: Customer[] = [];
  for (const customer of state.queue) {
    if (customer.deadlineTick <= tick) resolveCustomer(result, customer, 'patience_expired');
    else remaining.push(customer);
  }
  state.queue = remaining;
  state.phase = 'decision'; result.stage = 'decision';
  return finish(result);
}
export function applyAction(frame: EngineFrame, action: Action): EngineFrame {
  requireStage(frame, 'decision');
  ActionSchema.parse(action);
  if (!getLegalActions(frame.state).includes(action)) throw new Error(`Illegal action ${action} at tick ${frame.boundaryTick}`);
  const result = working(frame), state = result.state, tick = result.boundaryTick;
  if (action === 'SERVE') {
    const quantity = Math.min(3, state.queue.length, readyPortions(state));
    const served = state.queue.splice(0, quantity);
    let remaining = quantity;
    for (const batch of state.readyBatches) { const consumed = Math.min(batch.quantity, remaining); batch.quantity -= consumed; remaining -= consumed; }
    state.readyBatches = state.readyBatches.filter(batch => batch.quantity > 0);
    state.cashCents += quantity * 500;
    for (const customer of served) resolveCustomer(result, customer, 'served');
  } else if (action === 'COOK') {
    state.rawPortions -= 10; state.cooking = { quantity: 10, dueTick: tick + 5 };
  } else if (action === 'RESTOCK') {
    state.cashCents -= 4000; state.pendingRestock = { quantity: 20, dueTick: effectiveRestockDueTick(state), delayApplied: state.effects.some(effect => effect.type === 'supplier-delay' && effect.startsAt <= tick && effect.endsAt >= tick) };
    state.totals.purchasedPortions += 20; state.totals.restockOrders += 1;
  } else if (action === 'PROMOTE') {
    state.cashCents -= 500; state.promotion = { startsAt: tick + 1, endsAt: tick + 10 }; state.promotionEligibleAt = tick + 20; state.totals.promotions += 1;
  }
  result.events.push({ type: 'action-applied', tick, action }); state.phase = 'committed'; result.stage = 'committed';
  return finish(result);
}
export function advanceTick(frame: EngineFrame): EngineFrame {
  requireStage(frame, 'committed');
  if (frame.boundaryTick >= 120) throw new Error('Cannot advance terminal tick');
  const result = working(frame); result.boundaryTick += 1; result.state.tick = result.boundaryTick; result.stage = 'before-tick';
  return finish(result);
}
export function settle(frame: EngineFrame): EngineFrame {
  requireStage(frame, 'before-tick');
  if (frame.boundaryTick !== 120) throw new Error('Settlement is exactly at tick 120');
  const result = working(frame), state = result.state;
  if (state.cooking || state.pendingRestock) throw new Error('Settlement cannot contain in-flight stock');
  for (const customer of state.queue) resolveCustomer(result, customer, 'closing_unserved');
  state.queue = [];
  const quantity = readyPortions(state); state.readyBatches = [];
  if (quantity > 0) { state.totals.wasted += quantity; result.events.push({ type: 'ready-wasted', tick: 120, quantity, reason: 'closing' }); }
  state.promotion = null; state.effects = []; state.phase = 'closed'; result.stage = 'closed'; result.events.push({ type: 'closed', tick: 120 });
  return finish(result);
}
