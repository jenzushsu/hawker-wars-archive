import { describe, expect, it } from "vitest";
import { DECISION_STATE_EXAMPLES, DecisionStateError, parseDecisionState, type DecisionAction, type DecisionStateStatus } from "../apps/web/lib/decision-state.ts";

function fixture(status: DecisionStateStatus): Record<string, unknown> {
  const example = DECISION_STATE_EXAMPLES.find(item => item.status === status);
  if (!example) throw new Error("Missing fixture");
  return JSON.parse(JSON.stringify(example)) as Record<string, unknown>;
}

describe("example-only public decision presentation", () => {
  it("has five generic, immutable fixtures with unknown usage, cost and explanation", () => {
    expect(DECISION_STATE_EXAMPLES.map(item => item.status)).toEqual(["pending", "invalid", "timeout", "fallback", "missing-usage"]);
    expect(Object.isFrozen(DECISION_STATE_EXAMPLES)).toBe(true);
    for (const example of DECISION_STATE_EXAMPLES) {
      expect(example).toMatchObject({ schemaVersion: "decision-state-1", classification: "presentation-example", policyLabel: "Example policy", usage: null, cost: null, explanation: null });
      expect(Object.isFrozen(example)).toBe(true); expect(Object.isFrozen(example.outcome)).toBe(true);
      const parsed = parseDecisionState(JSON.parse(JSON.stringify(example)));
      expect(parsed).toEqual(example); expect(parsed).not.toBe(example); expect(parsed.outcome).not.toBe(example.outcome);
    }
    const serialized = JSON.stringify(DECISION_STATE_EXAMPLES);
    expect(serialized).not.toMatch(/Jev|Zoom|tokens|latency|profit|served|authorization|requestId|chainOfThought|rawResponse/i);
    // No fabricated numeric outcomes or measurements occur anywhere in the fixtures.
    const numbers: number[] = [];
    const visit = (value: unknown): void => {
      if (typeof value === "number") numbers.push(value);
      else if (value && typeof value === "object") Object.values(value).forEach(visit);
    };
    visit(DECISION_STATE_EXAMPLES); expect(numbers).toEqual([]);
  });

  it("keeps pending, invalid and timeout unaccepted and uncommitted", () => {
    const pending = parseDecisionState(fixture("pending"));
    const invalid = parseDecisionState(fixture("invalid"));
    const timeout = parseDecisionState(fixture("timeout"));
    expect(pending).toMatchObject({proposal:null,acceptedAction:null,fallbackAction:null,source:"none",outcome:{status:"pending"}});
    expect(invalid).toMatchObject({proposal:"COOK",acceptedAction:null,fallbackAction:null,source:"none",outcome:{status:"pending"}});
    expect(timeout).toMatchObject({proposal:null,acceptedAction:null,fallbackAction:null,source:"none",outcome:{status:"pending"}});
    for (const status of ["pending", "invalid", "timeout"] as const) {
      for (const patch of [
        {acceptedAction:"COOK"}, {fallbackAction:"WAIT"}, {source:"model"}, {source:"rules"},
        {outcome:{status:"committed",summary:"An action was applied."}},
        {outcome:{status:"pending",summary:"A result has happened."}},
      ]) expect(() => parseDecisionState({...fixture(status),...patch})).toThrow(DecisionStateError);
    }
    expect(() => parseDecisionState({...fixture("pending"),proposal:"SERVE"})).toThrow();
    expect(() => parseDecisionState({...fixture("timeout"),proposal:"WAIT"})).toThrow();
    expect(() => parseDecisionState({...fixture("invalid"),proposal:null})).toThrow();
  });

  it("labels a rules fallback separately from its rejected proposal", () => {
    expect(parseDecisionState(fixture("fallback"))).toMatchObject({proposal:"COOK",acceptedAction:null,fallbackAction:"WAIT",source:"rules",outcome:{status:"committed"}});
    for (const patch of [
      {acceptedAction:"COOK"}, {acceptedAction:"WAIT"}, {fallbackAction:null}, {source:"model"}, {source:"none"}, {outcome:{status:"pending"}},
    ]) expect(() => parseDecisionState({...fixture("fallback"),...patch})).toThrow();
    // An absent/invalid proposal can still be followed by an explicitly separate legal rules action.
    for (const fallbackAction of ["SERVE","COOK","RESTOCK","PROMOTE","WAIT"] satisfies DecisionAction[]) {
      expect(parseDecisionState({...fixture("fallback"),proposal:null,fallbackAction})).toMatchObject({acceptedAction:null,fallbackAction,source:"rules"});
    }
  });

  it("accepts the missing-usage action without converting unknown usage or cost into zero", () => {
    expect(parseDecisionState(fixture("missing-usage"))).toMatchObject({proposal:"SERVE",acceptedAction:"SERVE",fallbackAction:null,source:"model",usage:null,cost:null,outcome:{status:"committed"}});
    for (const patch of [
      {proposal:null}, {acceptedAction:null}, {acceptedAction:"WAIT"}, {fallbackAction:"WAIT"}, {source:"rules"},
      {outcome:{status:"pending"}}, {usage:0}, {cost:0}, {usage:{inputTokens:0}}, {cost:{currency:"USD",amount:0}},
    ]) expect(() => parseDecisionState({...fixture("missing-usage"),...patch})).toThrow();
    for (const action of ["SERVE","COOK","RESTOCK","PROMOTE","WAIT"] satisfies DecisionAction[]) {
      expect(parseDecisionState({...fixture("missing-usage"),proposal:action,acceptedAction:action})).toMatchObject({proposal:action,acceptedAction:action,usage:null,cost:null});
    }
  });

  it("rejects unknown fields, real provider attribution, free-form output and numeric outcome claims", () => {
    for (const key of ["authorization","apiKey","requestId","modelVersion","chainOfThought","rawPayload","latencyMs","provider"]) {
      expect(() => parseDecisionState({...fixture("missing-usage"),[key]:"private input"})).toThrow();
      const value = fixture("missing-usage");
      value.outcome = {...value.outcome as object,[key]:"private input"};
      expect(() => parseDecisionState(value)).toThrow();
    }
    for (const policyLabel of ["Jev", "Zoom Decisions", "Zoom Pro", "Example policy with credentials"]) expect(() => parseDecisionState({...fixture("pending"),policyLabel})).toThrow();
    for (const summary of ["The model privately reasoned as follows.", "Authorization: bearer private", "Served 3 customers for $15.", "", "x".repeat(100000)]) {
      expect(() => parseDecisionState({...fixture("fallback"),outcome:{status:"committed",summary}})).toThrow();
    }
    expect(() => parseDecisionState({...fixture("fallback"),outcome:{status:"committed",summary:"Example",served:3}})).toThrow();
    expect(() => parseDecisionState({...fixture("pending"),explanation:"I reasoned through hidden inputs"})).toThrow();
  });

  it("rejects malformed envelopes and every missing required field without coercion", () => {
    for (const value of [null,[],"pending",0,new Date(),Object.create({status:"pending"})]) expect(() => parseDecisionState(value)).toThrow(DecisionStateError);
    for (const field of Object.keys(fixture("pending"))) {
      const value = fixture("pending"); delete value[field];
      expect(() => parseDecisionState(value)).toThrow();
    }
    for (const patch of [
      {schemaVersion:"decision-state-2"}, {classification:"recorded-model-result"}, {status:"success"},
      {proposal:"FLY"}, {proposal:"cook"}, {acceptedAction:undefined}, {outcome:null},
    ]) expect(() => parseDecisionState({...fixture("invalid"),...patch})).toThrow();
    const nullPrototype = Object.assign(Object.create(null),fixture("pending"));
    expect(parseDecisionState(nullPrototype).status).toBe("pending");
    const symbolField = {...fixture("pending"),[Symbol("secret")]:"hidden"};
    expect(() => parseDecisionState(symbolField)).toThrow();
  });

  it("does not execute accessors or leak input-controlled errors", () => {
    let accessed = false;
    const input = fixture("pending");
    Object.defineProperty(input,"proposal",{get(){accessed = true;throw new Error("private payload");},enumerable:true});
    expect(() => parseDecisionState(input)).toThrow(DecisionStateError); expect(accessed).toBe(false);
    const nested = fixture("fallback");
    Object.defineProperty(nested.outcome,"summary",{get(){accessed = true;return "private";},enumerable:true});
    expect(() => parseDecisionState(nested)).toThrow(DecisionStateError); expect(accessed).toBe(false);
    const proxy = new Proxy({}, {getPrototypeOf(){throw new Error("private payload");}});
    expect(() => parseDecisionState(proxy)).toThrow("Invalid presentation example: input.");
    // Read a single snapshot of data descriptors; never trust a proxy's changing property reads.
    let propertyReads = 0;
    const changingInput = new Proxy(fixture("pending"), {get(){propertyReads++;return "private payload";}});
    expect(parseDecisionState(changingInput).status).toBe("pending"); expect(propertyReads).toBe(0);
  });
});
