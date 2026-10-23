import { DEMO_COMPETITORS, type DemoData } from "./demo.ts";

export class DemoLoadError extends Error {
  constructor(
    public readonly code: "empty" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "DemoLoadError";
  }
}
type RecordValue = Record<string, unknown>;
function invalid(path: string): never {
  throw new DemoLoadError("invalid", `Invalid offline replay: ${path}`);
}
function record(value: unknown, path: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid(path);
  return value as RecordValue;
}
function equal(value: unknown, expected: unknown, path: string) {
  if (value !== expected) invalid(path);
}
function text(value: unknown, path: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 10000)
    invalid(path);
}
function count(value: unknown, path: string, signed = false) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    (!signed && value < 0)
  )
    invalid(path);
}
function bool(value: unknown, path: string) {
  if (typeof value !== "boolean") invalid(path);
}
function list(value: unknown, path: string, length?: number): unknown[] {
  if (
    !Array.isArray(value) ||
    (length !== undefined && value.length !== length)
  )
    invalid(path);
  return value;
}
function choice(value: unknown, choices: readonly unknown[], path: string) {
  if (!choices.includes(value)) invalid(path);
}
const actions = ["SERVE", "COOK", "RESTOCK", "PROMOTE", "WAIT"];
const effects = ["bus", "rain", "supplier-delay"];
function choices(value: unknown, allowed: readonly string[], path: string) {
  const values = list(value, path);
  if (values.length > allowed.length || new Set(values).size !== values.length)
    invalid(path);
  values.forEach((item) => choice(item, allowed, path));
  return values;
}
function observation(
  value: unknown,
  tick: number,
  action: unknown,
  path: string,
) {
  const o = record(value, path);
  equal(o.tick, tick, `${path}.tick`);
  equal(o.remainingMinutes, 120 - tick, `${path}.remainingMinutes`);
  for (const key of [
    "cashCents",
    "queueCount",
    "readyPortions",
    "rawPortions",
    "oldestWaitMinutes",
  ])
    count(o[key], `${path}.${key}`);
  for (const key of [
    "headDeadlineInMinutes",
    "cookingDueInMinutes",
    "restockDueInMinutes",
  ])
    if (o[key] !== null) count(o[key], `${path}.${key}`);
  bool(o.promotionActive, `${path}.promotionActive`);
  choices(o.effects, effects, `${path}.effects`);
  const legal = choices(o.legalActions, actions, `${path}.legalActions`);
  if (!legal.includes(action)) invalid(`${path}.legalActions`);
}
function snapshot(value: unknown, tick: number, id: string, path: string) {
  const s = record(value, path),
    terminal = tick === 120;
  equal(s.id, id, `${path}.id`);
  equal(
    s.decisionSource,
    id === "rules" ? "rules-baseline" : "rules-demo-mirror",
    `${path}.decisionSource`,
  );
  equal(s.provisional, !terminal, `${path}.provisional`);
  count(s.profitCents, `${path}.profitCents`, true);
  if (
    typeof s.utilityPoints !== "number" ||
    !Number.isFinite(s.utilityPoints) ||
    Math.abs(s.utilityPoints) > Number.MAX_SAFE_INTEGER
  )
    invalid(`${path}.utilityPoints`);
  for (const key of [
    "queueCount",
    "readyPortions",
    "rawPortions",
    "cookingPortions",
    "pendingRestockPortions",
    "served",
    "abandoned",
    "wasted",
    "waitMinutes",
  ])
    count(s[key], `${path}.${key}`);
  choices(s.effects, effects, `${path}.effects`);
  text(s.consequence, `${path}.consequence`);
  if (terminal) {
    equal(s.action, null, `${path}.action`);
    equal(s.validation, "settled", `${path}.validation`);
    equal(s.rulePriority, null, `${path}.rulePriority`);
    equal(s.observationSummary, null, `${path}.observationSummary`);
    equal(s.queueCount, 0, `${path}.queueCount`);
  } else {
    choice(s.action, actions, `${path}.action`);
    choice(
      s.validation,
      ["valid-local-rules", "forced-wait"],
      `${path}.validation`,
    );
    if (s.validation === "forced-wait")
      equal(s.action, "WAIT", `${path}.action`);
    if (s.rulePriority !== null) count(s.rulePriority, `${path}.rulePriority`);
    observation(
      s.observationSummary,
      tick,
      s.action,
      `${path}.observationSummary`,
    );
  }
  return s;
}
// Compare structured values without relying on JSON object insertion order.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const x = a as RecordValue,
    y = b as RecordValue;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && same(x[k], y[k]))
  );
}
function frame(
  value: unknown,
  tick: number,
  previous: RecordValue | null,
  path: string,
) {
  const f = record(value, path);
  equal(f.tick, tick, `${path}.tick`);
  equal(f.minute, tick === 120 ? 120 : tick + 1, `${path}.minute`);
  equal(f.phase, tick === 120 ? "closed" : "committed", `${path}.phase`);
  const baseline = snapshot(
    f.rulesBaseline,
    tick,
    "rules",
    `${path}.rulesBaseline`,
  );
  list(f.stalls, `${path}.stalls`, 3).forEach((value, i) => {
    const stall = snapshot(
      value,
      tick,
      DEMO_COMPETITORS[i]!.id,
      `${path}.stalls[${i}]`,
    );
    for (const key of Object.keys(baseline))
      if (
        key !== "id" &&
        key !== "decisionSource" &&
        !same(stall[key], baseline[key])
      )
        invalid(`${path}.stalls[${i}].${key}`);
  });
  list(f.eventSummary, `${path}.eventSummary`).forEach((value) =>
    text(value, `${path}.eventSummary`),
  );
  const activity = record(f.customerActivity, `${path}.customerActivity`);
  const poses = list(
    activity.queuePoses,
    `${path}.customerActivity.queuePoses`,
    Math.min(3, baseline.queueCount as number),
  );
  poses.forEach((value) =>
    choice(
      value,
      ["walk", "wait", "impatient"],
      `${path}.customerActivity.queuePoses`,
    ),
  );
  for (const [key, total] of [
    ["received", "served"],
    ["departed", "abandoned"],
  ] as const) {
    count(activity[key], `${path}.customerActivity.${key}`);
    equal(
      activity[key],
      (baseline[total] as number) -
        ((previous?.[total] as number | undefined) ?? 0),
      `${path}.customerActivity.${key}`,
    );
  }
  bool(
    record(f.effectActivity, `${path}.effectActivity`).delivered,
    `${path}.effectActivity.delivered`,
  );
  return baseline;
}
/** Validate untrusted JSON before any rendering. No Node, engine, provider or schema-runtime dependency. */
export function parseDemoData(value: unknown): DemoData {
  const data = record(value, "root");
  for (const [key, expected] of Object.entries({
    schemaVersion: "web-demo-3",
    classification: "offline-rules-demo",
    currency: "SGD",
    baselineVersion: "rules-1",
    simulationVersion: "poc-1",
    scorerVersion: "utility-1",
    modelInferencePerformed: false,
    benchmarkResultsIncluded: false,
  }))
    equal(data[key], expected, key);
  text(data.disclosure, "disclosure");
  const definitions = record(data.scoreDefinitions, "scoreDefinitions");
  for (const key of ["profit", "utility", "provisional"])
    text(definitions[key], `scoreDefinitions.${key}`);
  list(data.competitors, "competitors", 3).forEach((value, i) => {
    const c = record(value, `competitors[${i}]`);
    for (const [key, expected] of Object.entries(DEMO_COMPETITORS[i]!))
      equal(c[key], expected, `competitors[${i}].${key}`);
  });
  const scenarios = list(data.scenarios, "scenarios");
  if (!scenarios.length)
    throw new DemoLoadError("empty", "No recorded scenarios are available.");
  if (scenarios.length !== 4) invalid("scenarios");
  const ids = new Set<unknown>();
  scenarios.forEach((value, index) => {
    const path = `scenarios[${index}]`,
      s = record(value, path);
    choice(s.id, ["clean", ...effects], `${path}.id`);
    if (ids.has(s.id)) invalid(`${path}.id`);
    ids.add(s.id);
    text(s.title, `${path}.title`);
    text(s.description, `${path}.description`);
    let previous: RecordValue | null = null;
    list(s.turns, `${path}.turns`, 120).forEach((turn, tick) => {
      previous = frame(turn, tick, previous, `${path}.turns[${tick}]`);
    });
    frame(s.terminal, 120, previous, `${path}.terminal`);
  });
  return value as DemoData;
}
