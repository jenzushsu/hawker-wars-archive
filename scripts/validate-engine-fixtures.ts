import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { acceptanceFixtures,executeAcceptanceFixture,valueAtPath } from '../tests/helpers/p2-fixture-runner.js';
/** Dev harness shared by the standalone P2-A validator; no expected output is used as an engine input. */
export function validateEngineFixtures(){
  let assertions=0;
  for(const fixture of acceptanceFixtures.cases){
    const before=JSON.stringify(fixture),execution=executeAcceptanceFixture(fixture);
    assert.equal(execution.assertionCount,fixture.expectations.length);
    for(const expectation of fixture.expectations){
      const boundary=execution.snapshots.get(expectation.at);assert.ok(boundary,`${fixture.id}: boundary ${expectation.at}`);
      const actual=valueAtPath(boundary,expectation.path),message=`${fixture.id}/${expectation.at}/${expectation.path}`;
      if(expectation.operator==='equals')assert.deepEqual(actual,expectation.value,message);
      else if(expectation.operator==='contains'||expectation.operator==='notContains'){
        assert.ok(Array.isArray(actual),message);
        const found=actual.some(value=>isDeepStrictEqual(value,expectation.value));
        assert.equal(found,expectation.operator==='contains',message);
      }else{
        assert.ok(Array.isArray(actual)&&expectation.value&&typeof expectation.value==='object'&&!Array.isArray(expectation.value),message);
        const fields=Object.entries(expectation.value);
        assert.ok(actual.some(value=>value&&typeof value==='object'&&fields.every(([k,v])=>isDeepStrictEqual((value as Record<string,unknown>)[k],v))),message);
      }
      assertions++;
    }
    assert.equal(JSON.stringify(fixture),before,'Fixture input mutated');
  }
  return {cases:acceptanceFixtures.cases.length,expectations:assertions};
}
