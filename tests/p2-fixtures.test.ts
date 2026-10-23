import { describe,expect,it } from 'vitest';
import { acceptanceFixtures,executeAcceptanceFixture,valueAtPath } from './helpers/p2-fixture-runner.js';

describe('P2-A execution of frozen P0 acceptance fixtures',()=>{
  it.each(acceptanceFixtures.cases)('$id: $description',fixture=>{
    const before=JSON.stringify(fixture);
    const result=executeAcceptanceFixture(fixture);
    expect(result.assertionCount).toBe(fixture.expectations.length);
    let assertions=0;
    for(const assertion of fixture.expectations) {
      const snapshot=result.snapshots.get(assertion.at);
      expect(snapshot,`${fixture.id}: missing execution boundary ${assertion.at}`).toBeDefined();
      const actual=valueAtPath(snapshot,assertion.path);
      const context=`${fixture.id} at ${assertion.at}: ${assertion.path}`;
      switch(assertion.operator) {
        case 'equals':expect(actual,context).toEqual(assertion.value);break;
        case 'contains':expect(actual,context).toContain(assertion.value);break;
        case 'notContains':expect(actual,context).not.toContain(assertion.value);break;
        case 'containsSubset':expect(actual,context).toEqual(expect.arrayContaining([expect.objectContaining(assertion.value as Record<string,unknown>)]));break;
      }
      assertions++;
    }
    expect(assertions).toBe(fixture.expectations.length);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});
