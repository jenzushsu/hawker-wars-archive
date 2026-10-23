import { describe,it,expect } from 'vitest';
import { SimulatorStateSchema,ObservationSchema,DecisionInputSchema,RunManifestSchema,ProviderEvidenceSchema,POC_CONFIG,CONTRACT_VERSIONS } from '../packages/shared/src/index.js';
import { validateArtifacts,FixtureSetSchema } from '../scripts/p0-artifacts.js';
import { canonicalConfig,configurationHash,readProjectJson } from '../scripts/config-snapshot.js';

const fixtureSet=FixtureSetSchema.parse(readProjectJson('fixtures/poc-1-acceptance.json'));
const byId=(id:string)=>{const f=fixtureSet.cases.find(c=>c.id===id);if(!f)throw new Error(id);return f;};
const expectation=(id:string,path:string)=>{const e=byId(id).expectations.find(e=>e.path===path);if(!e)throw new Error(`${id}:${path}`);return e.value;};

describe('P0 artifacts and boundaries',()=>{
 it('checks the checked configuration, source fixture coverage and balanced frozen cohorts',()=>{
  expect(validateArtifacts()).toMatchObject({fixtureCount:30,sourceCount:22,cleanSeeds:30,stressSeeds:6});
 });
 it('validates a real offline manifest and keeps all providers disabled',()=>{
  const m=RunManifestSchema.parse(readProjectJson('manifests/p0-offline-run.json'));
  expect(m.configurationHash).toBe(configurationHash);
  const providers=readProjectJson('manifests/providers-disabled.json');
  expect(Array.isArray(providers)).toBe(true);
  for(const p of providers as unknown[])expect(ProviderEvidenceSchema.parse(p).liveDispatchEnabled).toBe(false);
 });
 it('rejects a seed-bearing nested field at the actual decision input boundary',()=>{
  const o=ObservationSchema.parse(readProjectJson('fixtures/observation-2-initial.json'));
  const input={roundId:'34801eca-7cd6-4c23-a116-8aee7db040ae',tick:0,observation:o,legalActions:o.legalActions};
  expect(DecisionInputSchema.safeParse(input).success).toBe(true);
  expect(DecisionInputSchema.safeParse({...input,observation:{...o,readyBatches:[{...o.readyBatches[0],seed:1000}]}}).success).toBe(false);
 });
 it('keeps configuration identity stable across key insertion order and detects mutations',()=>{
  expect(canonicalConfig({b:2,a:{y:2,x:1}})).toBe(canonicalConfig({a:{x:1,y:2},b:2}));
  expect(canonicalConfig({a:[1,2]})).not.toBe(canonicalConfig({a:[2,1]}));
  expect(()=>canonicalConfig({a:undefined})).toThrow();
  expect(()=>canonicalConfig({a:-0})).toThrow();
 });
 it.each(fixtureSet.cases.filter(c=>c.setupMode==='episode'))('validates the standard episode ledger in $id',c=>{
  expect(SimulatorStateSchema.safeParse(c.given).success).toBe(true);
 });
 it('rejects an episode inventory/cash ledger mutation',()=>{
  const s=byId('SCORE-02').given;
  expect(SimulatorStateSchema.safeParse({...s,rawPortions:31}).success).toBe(false);
  expect(SimulatorStateSchema.safeParse({...s,cashCents:19999}).success).toBe(false);
 });
 it('has fixtures for arrivals preceding abandonment and exact cooking cutoff',()=>{
  const tick=readProjectJson('fixtures/tick-order-1.json') as {steps:{order:number;id:string}[];closing:{acceptDecisions:boolean;acceptArrivals:boolean}};
  expect(tick.steps.map(s=>s.order)).toEqual([1,2,3,4,5,6,7,8]);
  expect(tick.steps[2]?.id).toContain('admit');expect(tick.steps[3]?.id).toContain('patience');
  expect(tick.closing).toMatchObject({acceptArrivals:false,acceptDecisions:false});
  expect(byId('MECH-10').given.tick+POC_CONFIG.cookingMinutes).toBe(120);
  expect(byId('MECH-10-COOK-EARLY').given.tick+POC_CONFIG.cookingMinutes).toBe(119);
 });
 it('pins all versioned contracts in fixture data',()=>{
  expect(fixtureSet.contracts).toEqual(CONTRACT_VERSIONS);
 });
});

describe('independent arithmetic review of hand-calculated expectations (not engine execution)',()=>{
 it('recomputes SCORE-01 settlement two ways and preserves stock',()=>{
  const s=byId('SCORE-01').given;
  const profit=s.cashCents+200*s.rawPortions-28400;
  const equivalent=500*s.totals.served-200*(42+s.totals.purchasedPortions)-500*s.totals.promotions+200*s.rawPortions;
  expect(profit).toBe(16000);expect(equivalent).toBe(profit);
  expect(profit).toBe(expectation('SCORE-01','profitCents'));
  expect(profit-100*s.totals.abandoned-5*s.totals.waitMinutes-50*s.totals.wasted).toBe(expectation('SCORE-01','utilityPoints'));
  expect(42+s.totals.purchasedPortions).toBe(s.rawPortions+s.totals.served+s.totals.wasted);
 });
 it('checks the no-demand WAIT terminal loss without claiming to run the episode',()=>{
  const profit=20000+200*30-28400;
  expect(profit).toBe(expectation('SCORE-02','profitCents'));
  expect(profit-50*12).toBe(expectation('SCORE-02','utilityPoints'));
 });
 it('checks inclusive deadline and closing wait arithmetic',()=>{
  const c=byId('SCORE-03').given.queue[0]!;
  expect(120-c.arrivalTick).toBe(2);
  expect(100+5*(120-c.arrivalTick)).toBe(110);
 });
});
