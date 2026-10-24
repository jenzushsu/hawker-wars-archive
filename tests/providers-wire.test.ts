import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DecisionInputSchema, type DecisionInput } from '../packages/shared/src/index.js';
import { buildRequest, canonicalDecisionContext, parseResponse, ForcedWaitError, WireContractError } from '../packages/providers/src/wire.js';

function input(): DecisionInput {
  const observation = JSON.parse(readFileSync(new URL('../fixtures/observation-2-initial.json', import.meta.url), 'utf8'));
  return DecisionInputSchema.parse({ roundId: '34801eca-7cd6-4c23-a116-8aee7db040ae', tick: 0, observation, legalActions: observation.legalActions });
}
function zoomRaw() {
  return { model: 'zoom-decisions', request_id: 'zoom-request-1', answers: [{ name: 'action', type: 'choice', choice: 'COOK', probabilities: [{ value: 'COOK', probability: 0.1 }, { value: 'RESTOCK', probability: 0.2 }, { value: 'PROMOTE', probability: 0.3 }, { value: 'WAIT', probability: 0.4 }] }], usage: { input_units: 100, output_units: 10, unit_type: 'tokens', details: { cached_input_tokens: 5 } } };
}
function jevRaw() {
  return { model: 'jev-preview', request_id: 'jev-request-1', answers: { action: { type: 'choice', choice: 'COOK', confidence: 0.7, probabilities: { WAIT: 0.4, PROMOTE: 0.3, RESTOCK: 0.2, COOK: 0.1 } } }, usage: { input_tokens: 100, output_tokens: 10 } };
}

describe('wire requests', () => {
  it('sends byte-identical canonical context/objective and equivalent named legal choices to both providers', () => {
    const value = input(), zoom = buildRequest('zoom', value), jev = buildRequest('jev', value, 'jev-preview');
    expect(zoom.body.input).toBe(jev.body.state);
    const context = JSON.parse(zoom.body.input as string);
    expect(context.objective.scorer).toBe('utility-1');
    expect(context.objective.formula).toContain('100*abandoned');
    expect(context.publicRules.mechanics.initialWealthCents).toBe(28400);
    expect(context.publicRules.demandDefaults.streams).toContain('patience');
    expect(context.legalActions).toEqual(value.legalActions);
    expect(zoom.endpoint).toBe('https://api.zoom.us/v2/aiservices/decisions/decide');
    expect(jev.endpoint).toBe('https://api.typesafe.ai/v1/systemone');
    const z = (zoom.body.questions as { name: string; type: string; instructions: string; choices: { value: string }[] }[])[0]!;
    const j = (jev.body.questions as { action: { type: string; instructions: string; criteria: Record<string, unknown> } }).action;
    expect(z.name).toBe('action'); expect(z.type).toBe('choice'); expect(j.type).toBe('choice');
    expect(z.instructions).toBe(j.instructions);
    expect(z.choices.map(c => c.value)).toEqual(Object.keys(j.criteria));
    expect(Object.values(j.criteria)).toEqual([null, null, null, null]);
  });
  it('presents identical stockout choices and consequences to Jev, Standard and Pro', () => {
    const value = input();
    value.legalActions = ['RESTOCK', 'WAIT']; value.observation.legalActions = ['RESTOCK', 'WAIT'];
    value.observation.rawPortions = 0; value.observation.readyBatches = [];
    value.observation.cooking = null; value.observation.pendingRestock = null;
    value.observation.totals.wasted = 42; // Preserve the initial 42-portion inventory ledger.
    const requests = ['jev', 'zoom', 'zoom-pro'].map(provider => buildRequest(provider as 'jev'|'zoom'|'zoom-pro', value, 'jev-preview'));
    const questions = requests.map((r, i) => i === 0
      ? (r.body.questions as { action: { instructions: string } }).action
      : (r.body.questions as { instructions: string }[])[0]!);
    expect(questions[1]!.instructions).toBe(questions[0]!.instructions);
    expect(questions[2]!.instructions).toBe(questions[0]!.instructions);
    expect(questions[0]!.instructions).toContain('RESTOCK: Pay 4000 cents for 20 raw portions');
    expect(questions[0]!.instructions).toContain('WAIT does not place an order');
    expect(questions[0]!.instructions).not.toContain('COOK:');
    expect(requests[1]!.body.input).toBe(requests[0]!.body.state);
    expect(requests[2]!.body.input).toBe(requests[0]!.body.state);
    expect(JSON.parse(requests[0]!.body.state as string).promptVersion).toBe('hawker-decision-prompt-2');
  });
  it('requires explicit Jev model and never silently defaults to latest', () => {
    expect(() => buildRequest('jev', input())).toThrow(WireContractError);
    expect(buildRequest('jev', input(), 'jev-preview').requestedModel).toBe('jev-preview');
    expect(() => buildRequest('jev', input(), 'key\nprivate')).toThrow(WireContractError);
    expect(buildRequest('zoom-pro', input()).requestedModel).toBe('zoom-decisions-pro');
  });
  it('omits round identifiers, credentials, evaluation metadata and future inputs', () => {
    const value = input(), context = canonicalDecisionContext(value);
    expect(context).not.toContain(value.roundId);
    expect(context).not.toContain('TRIAL_CONFIG'); expect(context).not.toContain('1000');
    expect(() => buildRequest('zoom', { ...value, secret: 'do-not-leak' } as DecisionInput)).toThrow(WireContractError);
    try { buildRequest('zoom', { ...value, secret: 'do-not-leak' } as DecisionInput); } catch (error) { expect(String(error)).not.toContain('do-not-leak'); }
  });
  it('never builds a request for sole WAIT', () => {
    const value = input(); value.legalActions = ['WAIT']; value.observation.legalActions = ['WAIT'];
    expect(() => buildRequest('zoom', value)).toThrow(ForcedWaitError);
    expect(() => buildRequest('jev', value, 'jev-preview')).toThrow(ForcedWaitError);
  });
  it('keeps canonical semantic context stable when object insertion order changes', () => {
    const a = input(), b = { legalActions: a.legalActions, observation: a.observation, tick: a.tick, roundId: a.roundId };
    expect(canonicalDecisionContext(a)).toBe(canonicalDecisionContext(b));
  });
});

describe('validated response normalization', () => {
  it('accepts documented Zoom Standard alias normalization while preserving native usage units', () => {
    const parsed = parseResponse('zoom', input(), 'zoom-decisions-standard', zoomRaw(), 25);
    expect(parsed.result).toMatchObject({ provider: 'zoom', action: 'COOK', status: 'success', modelVersion: 'zoom-decisions', requestId: 'zoom-request-1', latencyMs: 25 });
    expect(parsed.result.usage).toBeUndefined();
    expect(parsed.result.confidence).toBeUndefined();
    expect(parsed.nativeUsage).toEqual({ schemaVersion: 'provider-native-usage-1', provider: 'zoom', inputUnits: 100, outputUnits: 10, unitType: 'tokens', cachedInputTokens: 5 });
    expect(parsed.result.probabilities?.map(p => p.action)).toEqual(input().legalActions);
  });
  it('accepts exact Pro identity and rejects substituting Standard or a different model', () => {
    const raw = zoomRaw(); raw.model = 'zoom-decisions-pro';
    expect(parseResponse('zoom-pro', input(), 'zoom-decisions-pro', raw, 10).result.provider).toBe('zoom-pro');
    expect(() => parseResponse('zoom-pro', input(), 'zoom-decisions-pro', zoomRaw(), 10)).toThrow(WireContractError);
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', raw, 10)).toThrow(WireContractError);
    expect(() => parseResponse('zoom-pro', input(), 'zoom-decisions-standard', raw, 10)).toThrow(WireContractError);
  });
  it('normalizes Jev label maps and reported token counts without inventing cost', () => {
    const parsed = parseResponse('jev', input(), 'jev-preview', jevRaw(), 10);
    expect(parsed.result).toMatchObject({ provider: 'jev', modelVersion: 'jev-preview', action: 'COOK', usage: { inputTokens: 100, outputTokens: 10 }, confidence: 0.7 });
    expect(parsed.result.confidenceSemantics).toContain('Provider-reported');
    expect(parsed.result.usage?.costMicros).toBeUndefined();
    expect(parsed.result.probabilities?.map(p => p.action)).toEqual(input().legalActions);
    expect(parsed.nativeUsage).toEqual({ schemaVersion: 'provider-native-usage-1', provider: 'jev', inputUnits: 100, outputUnits: 10, unitType: 'tokens' });
  });
  it('keeps absent/null Jev usage absent instead of turning it into zero', () => {
    const raw = jevRaw(); (raw.usage as unknown as Record<string, unknown>).input_tokens = null; (raw.usage as unknown as Record<string, unknown>).output_tokens = null;
    const parsed = parseResponse('jev', input(), 'jev-preview', raw, 10);
    expect(parsed.result.usage).toBeUndefined();
    expect(parsed.nativeUsage).toEqual({ schemaVersion: 'provider-native-usage-1', provider: 'jev', unitType: 'tokens' });
  });
  it('does not fabricate probability/confidence fields when they are absent', () => {
    const raw = { model: 'zoom-decisions', answers: [{ name: 'action', type: 'choice', choice: 'WAIT' }] };
    const parsed = parseResponse('zoom', input(), 'zoom-decisions-standard', raw, 10);
    expect(parsed.result.probabilities).toBeUndefined(); expect(parsed.result.confidence).toBeUndefined(); expect(parsed.nativeUsage).toBeUndefined();
  });
  it('drops unknown body/answer/usage fields and Zoom confidence instead of leaking them', () => {
    const raw = zoomRaw() as unknown as Record<string, unknown>;
    raw.apiKey = 'secret-1'; raw.hidden_reasoning = 'private-chain';
    const answers = raw.answers as Record<string, unknown>[]; answers[0]!.explanation = 'do-not-echo'; answers[0]!.confidence = 0.99;
    const usage = raw.usage as Record<string, unknown>; usage.authorization = 'private-token';
    const output = JSON.stringify(parseResponse('zoom', input(), 'zoom-decisions-standard', raw, 10));
    for (const value of ['secret-1', 'private-chain', 'do-not-echo', 'private-token', 'confidence']) expect(output).not.toContain(value);
  });
  it.each([
    { answers: [] },
    { answers: [{ name: 'different', type: 'choice', choice: 'COOK' }] },
    { answers: [{ name: 'action', type: 'score', choice: 'COOK' }] },
    { answers: [{ name: 'action', type: 'choice', choice: 'SERVE' }] },
    { answers: [{ name: 'action', type: 'choice', choice: 'COOK' }, { name: 'extra', type: 'choice', choice: 'WAIT' }] },
  ])('rejects malformed or mismatched Zoom answer: %o', update => {
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', { ...zoomRaw(), ...update }, 10)).toThrow(WireContractError);
  });
  it('rejects malformed Jev names, extra answers, wrong type, illegal choice and wrong model', () => {
    for (const answers of [{ other: jevRaw().answers.action }, { action: jevRaw().answers.action, other: {} }, { action: { type: 'score', choice: 'COOK' } }, { action: { type: 'choice', choice: 'SERVE' } }]) {
      expect(() => parseResponse('jev', input(), 'jev-preview', { ...jevRaw(), answers }, 10)).toThrow(WireContractError);
    }
    expect(() => parseResponse('jev', input(), 'jev-preview', { ...jevRaw(), model: 'jev-different' }, 10)).toThrow(WireContractError);
  });
  it('treats refusal as a sanitized failure', () => {
    try { parseResponse('zoom', input(), 'zoom-decisions-standard', { ...zoomRaw(), answers: [{ name: 'action', type: 'refusal', message: 'private-provider-message' }] }, 10); throw new Error('expected rejection'); }
    catch (error) { expect(error).toBeInstanceOf(WireContractError); expect((error as WireContractError).code).toBe('refusal'); expect(String(error)).not.toContain('private-provider-message'); }
  });
  it.each([
    [{ value: 'COOK', probability: 1 }],
    [{ value: 'COOK', probability: 0.1 }, { value: 'COOK', probability: 0.2 }, { value: 'PROMOTE', probability: 0.3 }, { value: 'WAIT', probability: 0.4 }],
    [{ value: 'COOK', probability: NaN }, { value: 'RESTOCK', probability: 0.2 }, { value: 'PROMOTE', probability: 0.3 }, { value: 'WAIT', probability: 0.4 }],
    [{ value: 'COOK', probability: 0.5 }, { value: 'RESTOCK', probability: 0.5 }, { value: 'PROMOTE', probability: 0.5 }, { value: 'WAIT', probability: 0.5 }],
  ].map(probabilities => ({ probabilities })))('rejects invalid/incomplete/duplicate distributions', ({ probabilities }) => {
    const raw = zoomRaw(); raw.answers[0]!.probabilities = probabilities;
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', raw, 10)).toThrow(WireContractError);
  });
  it('rejects unsafe counters and unbounded/unsafe response identifiers', () => {
    const raw = zoomRaw(); raw.usage.input_units = -1;
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', raw, 10)).toThrow(WireContractError);
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', { ...zoomRaw(), request_id: 'secret\nheader' }, 10)).toThrow(WireContractError);
    expect(() => parseResponse('zoom', input(), 'zoom-decisions-standard', { ...zoomRaw(), model: 'x'.repeat(201) }, 10)).toThrow(WireContractError);
    expect(() => parseResponse('jev', input(), 'jev-preview', { ...jevRaw(), usage: { input_tokens: 1.5, output_tokens: 10 } }, 10)).toThrow(WireContractError);
  });
  it('rejects late or noncanonical latency and does not mutate request/response data', () => {
    const value = input(), raw = zoomRaw(), before = JSON.stringify({ value, raw });
    expect(() => parseResponse('zoom', value, 'zoom-decisions-standard', raw, 4001)).toThrow(WireContractError);
    expect(() => parseResponse('zoom', value, 'zoom-decisions-standard', raw, -0)).toThrow(WireContractError);
    parseResponse('zoom', value, 'zoom-decisions-standard', raw, 4000);
    expect(JSON.stringify({ value, raw })).toBe(before);
  });
});
