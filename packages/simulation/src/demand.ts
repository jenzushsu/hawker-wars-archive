import { createHash } from 'node:crypto';
import { DEMAND_CONFIG, POC_CONFIG } from '../../shared/src/config.js';

export type DemandStream = typeof DEMAND_CONFIG.streams[number];
export type DemandScenario = 'clean' | 'bus' | 'rain' | 'supplier-delay';
export type ArrivalSource = 'base' | 'bus' | 'promotion';
export interface KeyedDraw {
  readonly input: string;
  readonly digestHex: string;
  readonly r: number;
  readonly u: number;
}
/** Private evaluator data. Never forward this object wholesale to a provider. */
export interface PotentialArrival {
  readonly id: string;
  readonly publicId: string;
  readonly arrivalTick: number;
  readonly patience: number;
  readonly deadlineTick: number;
  readonly source: ArrivalSource;
  readonly ordinal: number;
  readonly slotIndex: number;
  readonly rainKeep: boolean;
}
export interface ScheduledShock {
  readonly id: string;
  readonly type: Exclude<DemandScenario, 'clean'>;
  readonly effectiveTick: number;
  readonly endsAt: number;
}
export interface DemandSchedule {
  readonly version: 'demand-1';
  readonly seed: number;
  readonly scenario: DemandScenario;
  readonly shock: ScheduledShock | null;
  readonly ticks: readonly (readonly PotentialArrival[])[];
  readonly privateToPublicIds: Readonly<Record<string, string>>;
  readonly hash: string;
}
export interface EngineArrival {
  id: string;
  arrivalTick: number;
  patience: number;
  deadlineTick: number;
}

function integer(value: number, label: string, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a canonical nonnegative integer at most ${maximum}`);
  }
}
function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
function canonicalSchedule(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalSchedule).join(',')}]`;
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalSchedule(record[key])}`).join(',')}}`;
  }
  throw new Error('Schedule identity accepts canonical integer-only JSON data');
}

/** Exact keyed draw; no mutable PRNG state or action-dependent stream consumption. */
export function keyedDraw(seed: number, stream: DemandStream, tick: number, index: number): KeyedDraw {
  integer(seed, 'seed'); integer(tick, 'tick'); integer(index, 'index');
  if (!(DEMAND_CONFIG.streams as readonly string[]).includes(stream)) throw new Error('Unknown demand stream');
  const input = `${DEMAND_CONFIG.drawPrefix}|${seed}|${stream}|${tick}|${index}`;
  const digest = createHash('sha256').update(input, 'utf8').digest();
  const r = digest.readUInt32BE(0);
  return Object.freeze({ input, digestHex: digest.toString('hex'), r, u: r / DEMAND_CONFIG.drawDenominator });
}

/** Build all potential arrivals before any policy runs. Action effects only filter this schedule. */
export function createDemandSchedule(seed: number, scenario: DemandScenario = 'clean', shockTick = 60): DemandSchedule {
  integer(seed, 'seed'); integer(shockTick, 'shockTick', POC_CONFIG.lastDecisionTick);
  if (!(['clean', 'bus', 'rain', 'supplier-delay'] as const).includes(scenario)) throw new Error('Unknown demand scenario');
  const shock: ScheduledShock | null = scenario === 'clean' ? null : {
    id: `demand-1:seed-${seed}:${scenario}:${shockTick}`,
    type: scenario, effectiveTick: shockTick,
    endsAt: shockTick + (scenario === 'bus' ? 0 : 9),
  };
  const ticks: PotentialArrival[][] = [];
  const privateToPublicIds: Record<string, string> = {};
  for (let tick = POC_CONFIG.firstDecisionTick; tick <= POC_CONFIG.lastDecisionTick; tick++) {
    const countDraw = keyedDraw(seed, 'base_count', tick, 0).u;
    const peak = tick >= 30 && tick <= 89;
    const baseCount = peak ? (countDraw < 0.5 ? 1 : 2) : (countDraw < 0.5 ? 0 : countDraw < 0.9 ? 1 : 2);
    const busCount = shock?.type === 'bus' && shock.effectiveTick === tick ? DEMAND_CONFIG.busArrivals : 0;
    const promotionCount = keyedDraw(seed, 'promo_count', tick, 0).u < DEMAND_CONFIG.promotionExtraThreshold ? 1 : 0;
    const arrivals: PotentialArrival[] = [];
    const counts: readonly [ArrivalSource, number][] = [['base', baseCount], ['bus', busCount], ['promotion', promotionCount]];
    let slotIndex = 0;
    for (const [source, count] of counts) {
      for (let ordinal = 0; ordinal < count; ordinal++, slotIndex++) {
        const patience = DEMAND_CONFIG.patienceMinimum + keyedDraw(seed, 'patience', tick, slotIndex).r % DEMAND_CONFIG.patienceModulo;
        const publicId = `customer-${tick}-${source}-${ordinal}`;
        const id = `seed-${seed}:${publicId}`;
        privateToPublicIds[id] = publicId;
        arrivals.push({ id, publicId, arrivalTick: tick, patience, deadlineTick: tick + patience,
          source, ordinal, slotIndex,
          rainKeep: source !== 'base' || keyedDraw(seed, 'rain_keep', tick, slotIndex).u < DEMAND_CONFIG.rainKeepThreshold,
        });
      }
    }
    ticks.push(arrivals);
  }
  const contents = { version: 'demand-1' as const, seed, scenario, shock, ticks, privateToPublicIds };
  const hash = createHash('sha256').update('hawker-wars|demand-1|schedule\n', 'utf8').update(canonicalSchedule(contents), 'utf8').digest('hex');
  return freezeDeep({ ...contents, hash });
}

/** Select this policy's realized arrivals, retaining original slots, IDs and patience draws. */
export function arrivalsAt(schedule: DemandSchedule, tick: number, promotionActive = false): readonly PotentialArrival[] {
  integer(tick, 'tick', POC_CONFIG.lastDecisionTick);
  if (typeof promotionActive !== 'boolean') throw new Error('promotionActive must be boolean');
  const rain = schedule.shock?.type === 'rain' && tick >= schedule.shock.effectiveTick && tick <= schedule.shock.endsAt;
  return Object.freeze(schedule.ticks[tick]!.filter(a =>
    (a.source !== 'promotion' || promotionActive) && (a.source !== 'base' || !rain || a.rainKeep),
  ));
}

/** Strip private evaluator identity and random-draw metadata before entering state. */
export function toEngineArrival(arrival: PotentialArrival): EngineArrival {
  return { id: arrival.publicId, arrivalTick: arrival.arrivalTick, patience: arrival.patience, deadlineTick: arrival.deadlineTick };
}

export function eventAt(schedule: DemandSchedule, tick: number): ScheduledShock | undefined {
  integer(tick, 'tick', POC_CONFIG.lastDecisionTick);
  return schedule.shock?.effectiveTick === tick ? schedule.shock : undefined;
}
