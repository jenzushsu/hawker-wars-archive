/** Browser-safe public projection of recorded local rules episodes. No engine or provider imports. */
export type DemoAction = 'SERVE' | 'COOK' | 'RESTOCK' | 'PROMOTE' | 'WAIT';
export type DemoCompetitorId = 'jev' | 'zoom' | 'zoom-pro';
export type DemoScenarioId = 'clean' | 'bus' | 'rain' | 'supplier-delay';
export type DemoEffect = 'bus' | 'rain' | 'supplier-delay';
export interface DemoCompetitor { id: DemoCompetitorId; name: string; shortName: string; accent: 'green' | 'blue' | 'amber' }
export interface DemoObservationSummary {
  tick: number;
  remainingMinutes: number;
  cashCents: number;
  queueCount: number;
  readyPortions: number;
  rawPortions: number;
  oldestWaitMinutes: number;
  headDeadlineInMinutes: number | null;
  cookingDueInMinutes: number | null;
  restockDueInMinutes: number | null;
  promotionActive: boolean;
  effects: DemoEffect[];
  legalActions: DemoAction[];
}
export interface DemoPolicySnapshot {
  id: DemoCompetitorId | 'rules';
  decisionSource: 'rules-demo-mirror' | 'rules-baseline';
  action: DemoAction | null;
  validation: 'valid-local-rules' | 'forced-wait' | 'settled';
  rulePriority: number | null;
  profitCents: number;
  utilityPoints: number;
  provisional: boolean;
  queueCount: number;
  readyPortions: number;
  rawPortions: number;
  cookingPortions: number;
  pendingRestockPortions: number;
  served: number;
  abandoned: number;
  wasted: number;
  waitMinutes: number;
  effects: DemoEffect[];
  observationSummary: DemoObservationSummary | null;
  consequence: string;
}
export interface DemoCustomerActivity {
  /** Bounded samples from the first three committed queue members; no customer IDs. */
  queuePoses: ('walk' | 'wait' | 'impatient')[];
  received: number;
  departed: number;
}
export interface DemoEffectActivity {
  /** An actual restock-delivered event at this committed boundary, never an order or prediction. */
  delivered: boolean;
}
export interface DemoTurn {
  effectActivity: DemoEffectActivity;
  customerActivity: DemoCustomerActivity;
  tick: number;
  /** One-based presentation ordinal; tick remains the authoritative game-minute boundary. */
  minute: number;
  phase: 'committed';
  stalls: [DemoPolicySnapshot, DemoPolicySnapshot, DemoPolicySnapshot];
  rulesBaseline: DemoPolicySnapshot;
  eventSummary: string[];
}
export interface DemoTerminal {
  effectActivity: DemoEffectActivity;
  customerActivity: DemoCustomerActivity;
  tick: 120;
  minute: 120;
  phase: 'closed';
  stalls: [DemoPolicySnapshot, DemoPolicySnapshot, DemoPolicySnapshot];
  rulesBaseline: DemoPolicySnapshot;
  eventSummary: string[];
}
export interface DemoScenario {
  id: DemoScenarioId;
  title: string;
  description: string;
  turns: DemoTurn[];
  terminal: DemoTerminal;
}
export interface DemoData {
  schemaVersion: 'web-demo-3';
  classification: 'offline-rules-demo';
  disclosure: string;
  currency: 'SGD';
  baselineVersion: 'rules-1';
  simulationVersion: 'poc-1';
  scorerVersion: 'utility-1';
  modelInferencePerformed: false;
  benchmarkResultsIncluded: false;
  competitors: [DemoCompetitor, DemoCompetitor, DemoCompetitor];
  scenarios: [DemoScenario, DemoScenario, DemoScenario, DemoScenario];
  scoreDefinitions: { profit: string; utility: string; provisional: string };
}
export const DEMO_COMPETITORS: readonly DemoCompetitor[] = [
  { id: 'jev', name: 'TypeSafe Jev', shortName: 'Jev', accent: 'green' },
  { id: 'zoom', name: 'Zoom Decisions', shortName: 'Zoom', accent: 'blue' },
  { id: 'zoom-pro', name: 'Zoom Decisions Pro', shortName: 'Zoom Pro', accent: 'amber' },
];
export const DEMO_SCENARIOS: readonly { id: DemoScenarioId; title: string; description: string }[] = [
  { id: 'clean', title: 'Lunch service', description: 'The recorded lunch service without an external shock.' },
  { id: 'bus', title: 'Bus arrival', description: 'A recorded six-customer bus arrival interrupts lunch service.' },
  { id: 'rain', title: 'Rain', description: 'Recorded rain temporarily reduces base arrivals.' },
  { id: 'supplier-delay', title: 'Supplier delay', description: 'A recorded supplier delay puts inventory planning under pressure.' },
];
export function getScenario(data: DemoData, id: DemoScenarioId = 'clean'): DemoScenario {
  const scenario = data.scenarios.find(item => item.id === id);
  if (!scenario) throw new Error('Unknown demo scenario');
  return scenario;
}
/** Clamp UI seeking to existing recorded turns. Settlement is available separately as scenario.terminal. */
export function getTurn(scenario: DemoScenario, index: number): DemoTurn {
  if (!Number.isFinite(index)) throw new Error('Invalid demo turn');
  const turn = scenario.turns[Math.max(0, Math.min(scenario.turns.length - 1, Math.floor(index)))];
  if (!turn) throw new Error('Demo contains no turns');
  return turn;
}
export function formatGameMoney(cents: number): string {
  return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 2 }).format(cents / 100);
}
