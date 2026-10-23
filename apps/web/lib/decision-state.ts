/** Local presentation examples only. This contract cannot represent provider responses or a replay turn. */
export type DecisionAction = "SERVE" | "COOK" | "RESTOCK" | "PROMOTE" | "WAIT";
export type DecisionStateStatus = "pending" | "invalid" | "timeout" | "fallback" | "missing-usage";
export type PresentationOutcome = Readonly<{ status: "pending" }> | Readonly<{ status: "committed"; summary: string }>;

interface ExampleBase {
  readonly schemaVersion: "decision-state-1";
  readonly classification: "presentation-example";
  readonly policyLabel: "Example policy";
  /** Unknown in this example-only version. Zero would claim a measurement that does not exist. */
  readonly usage: null;
  readonly cost: null;
  readonly explanation: null;
}
export type DecisionState = ExampleBase & (
  | { readonly status: "pending"; readonly proposal: null; readonly acceptedAction: null; readonly fallbackAction: null; readonly source: "none"; readonly outcome: Readonly<{ status: "pending" }> }
  | { readonly status: "invalid"; readonly proposal: DecisionAction; readonly acceptedAction: null; readonly fallbackAction: null; readonly source: "none"; readonly outcome: Readonly<{ status: "pending" }> }
  | { readonly status: "timeout"; readonly proposal: null; readonly acceptedAction: null; readonly fallbackAction: null; readonly source: "none"; readonly outcome: Readonly<{ status: "pending" }> }
  | { readonly status: "fallback"; readonly proposal: DecisionAction | null; readonly acceptedAction: null; readonly fallbackAction: DecisionAction; readonly source: "rules"; readonly outcome: Readonly<{ status: "committed"; summary: string }> }
  | { readonly status: "missing-usage"; readonly proposal: DecisionAction; readonly acceptedAction: DecisionAction; readonly fallbackAction: null; readonly source: "model"; readonly outcome: Readonly<{ status: "committed"; summary: string }> }
);

export class DecisionStateError extends Error {
  readonly code = "invalid-presentation-example";
  constructor(path: string) {
    super(`Invalid presentation example: ${path}.`);
    this.name = "DecisionStateError";
  }
}

const ACTIONS: readonly DecisionAction[] = ["SERVE", "COOK", "RESTOCK", "PROMOTE", "WAIT"];
const STATUSES: readonly DecisionStateStatus[] = ["pending", "invalid", "timeout", "fallback", "missing-usage"];
const FIELDS = ["schemaVersion", "classification", "policyLabel", "status", "proposal", "acceptedAction", "fallbackAction", "source", "outcome", "usage", "cost", "explanation"] as const;
// Authored annotations are closed, rather than free-form slots for raw output, secrets or numeric claims.
const SUMMARIES = {
  fallback: "The rules fallback action is committed in this local presentation example. No gameplay result is supplied.",
  "missing-usage": "The accepted action is committed in this local presentation example. Usage and cost were not supplied.",
} as const;
function fail(path: string): never { throw new DecisionStateError(path); }

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(path);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) fail(`${path}.fields`);
  // Do not invoke accessor properties while projecting unknown input.
  const projected: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) fail(`${path}.fields`);
    projected[key] = descriptor.value;
  }
  return projected;
}
function equal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(path);
}
function action(value: unknown, path: string): DecisionAction | null {
  if (value === null) return null;
  if (typeof value !== "string" || !ACTIONS.includes(value as DecisionAction)) fail(path);
  return value as DecisionAction;
}

/** Strict safe projection. No extra fields, provider attribution, model prose or invented measurements. */
export function parseDecisionState(value: unknown): DecisionState {
  try {
    const input = record(value, FIELDS, "example");
    equal(input.schemaVersion, "decision-state-1", "schemaVersion");
    equal(input.classification, "presentation-example", "classification");
    equal(input.policyLabel, "Example policy", "policyLabel");
    if (typeof input.status !== "string" || !STATUSES.includes(input.status as DecisionStateStatus)) fail("status");
    const status = input.status as DecisionStateStatus;
    const proposal = action(input.proposal, "proposal");
    const acceptedAction = action(input.acceptedAction, "acceptedAction");
    const fallbackAction = action(input.fallbackAction, "fallbackAction");
    equal(input.usage, null, "usage"); equal(input.cost, null, "cost"); equal(input.explanation, null, "explanation");
    const committed = status === "fallback" || status === "missing-usage";
    const outcome = record(input.outcome, committed ? ["status", "summary"] : ["status"], "outcome");
    equal(outcome.status, committed ? "committed" : "pending", "outcome.status");
    const base: ExampleBase = {
      schemaVersion: "decision-state-1", classification: "presentation-example", policyLabel: "Example policy",
      usage: null, cost: null, explanation: null,
    };
    if (status === "fallback") {
      equal(acceptedAction, null, "acceptedAction");
      if (fallbackAction === null) fail("fallbackAction");
      equal(input.source, "rules", "source"); equal(outcome.summary, SUMMARIES.fallback, "outcome.summary");
      return Object.freeze({ ...base, status, proposal, acceptedAction: null, fallbackAction, source: "rules", outcome: Object.freeze({ status: "committed", summary: SUMMARIES.fallback }) });
    }
    if (status === "missing-usage") {
      if (proposal === null || acceptedAction === null || acceptedAction !== proposal) fail("acceptedAction");
      equal(fallbackAction, null, "fallbackAction"); equal(input.source, "model", "source");
      equal(outcome.summary, SUMMARIES["missing-usage"], "outcome.summary");
      return Object.freeze({ ...base, status, proposal, acceptedAction, fallbackAction: null, source: "model", outcome: Object.freeze({ status: "committed", summary: SUMMARIES["missing-usage"] }) });
    }
    equal(acceptedAction, null, "acceptedAction"); equal(fallbackAction, null, "fallbackAction"); equal(input.source, "none", "source");
    const pendingOutcome = Object.freeze({ status: "pending" as const });
    if (status === "invalid") {
      if (proposal === null) fail("proposal");
      return Object.freeze({ ...base, status, proposal, acceptedAction: null, fallbackAction: null, source: "none", outcome: pendingOutcome });
    }
    equal(proposal, null, "proposal");
    return Object.freeze({ ...base, status, proposal: null, acceptedAction: null, fallbackAction: null, source: "none", outcome: pendingOutcome });
  } catch (error) {
    if (error instanceof DecisionStateError) throw error;
    // Proxy/accessor failures must not expose input-controlled errors or payload fragments.
    throw new DecisionStateError("input");
  }
}

const common = {
  schemaVersion: "decision-state-1", classification: "presentation-example", policyLabel: "Example policy",
  acceptedAction: null, fallbackAction: null, source: "none", outcome: { status: "pending" }, usage: null, cost: null, explanation: null,
} as const;

/** UI fixtures only: never append these to recordings or dispatch their actions. */
export const DECISION_STATE_EXAMPLES: readonly DecisionState[] = Object.freeze([
  parseDecisionState({ ...common, status: "pending", proposal: null }),
  parseDecisionState({ ...common, status: "invalid", proposal: "COOK" }),
  parseDecisionState({ ...common, status: "timeout", proposal: null }),
  parseDecisionState({ ...common, status: "fallback", proposal: "COOK", fallbackAction: "WAIT", source: "rules", outcome: { status: "committed", summary: SUMMARIES.fallback } }),
  parseDecisionState({ ...common, status: "missing-usage", proposal: "SERVE", acceptedAction: "SERVE", source: "model", outcome: { status: "committed", summary: SUMMARIES["missing-usage"] } }),
]);
