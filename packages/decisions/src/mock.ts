import type { DecisionInput } from '../../shared/src/schemas.js';

export type MockFailureReason = 'network' | 'rate-limit' | 'timeout';
export type MockOutcome =
  | { kind: 'response'; response: unknown; elapsedMs: number }
  | { kind: 'failure'; reason: MockFailureReason; elapsedMs: number };
export type MockController = (input: DecisionInput) => MockOutcome;

/** A deterministic script, never an external provider. Exhaustion is an error, not a retry. */
export function scriptedMock(outcomes: readonly MockOutcome[]): { controller: MockController; readonly callCount: number } {
  const script = structuredClone(outcomes);
  let calls = 0;
  return {
    controller: () => {
      const outcome = script[calls++];
      if (!outcome) throw new Error('Mock script exhausted');
      return structuredClone(outcome);
    },
    get callCount() { return calls; },
  };
}
