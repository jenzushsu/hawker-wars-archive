import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {ProviderRuntimeSchema,activationBlockers} from '../packages/providers/src/activation.ts';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
it('reserves a full 120-call allowance per model across all three seeds',()=>{
  const plan=read('docs/providers/fair-campaign-plan.json');
  const prior=read('docs/deployment/evidence/prompt-v2/repeatability-experiment.json').after;
  const priorJev=prior.pools.find((p:{id:string})=>p.id==='jev-separate').reservedMicros;
  expect(plan.runs.map((r:{seed:number})=>r.seed)).toEqual([7,11,23]);
  expect(plan.maximumCallsPerProvider).toBe(3*120);
  expect(plan.jevCumulativeCapMicros-priorJev).toBe(3*120*2753);
  expect(2*120*1000).toBeLessThanOrEqual(250000);
  expect(prior.pools.find((p:{id:string})=>p.id==='zoom-shared').reservedMicros+plan.zoomAdditionalMaximumAllocationMicros).toBeLessThanOrEqual(plan.zoomCampaignCapMicros);
});
it('keeps every proposed run disabled until budget approval and chains identities',()=>{
  const plan=read('docs/providers/fair-campaign-plan.json');
  let previous='7268f741-0399-4473-b20e-f1c8bb7605eb';
  for(const run of plan.runs) {
    const approval=read(run.approval);
    expect(approval.status).toBe('pending-budget-approval');
    expect(approval.previousRoundId).toBe(previous);
    const config=ProviderRuntimeSchema.parse({...read(`manifests/provider-runtime-fair-seed-${run.seed}.json`),zoomCampaignException:read(`manifests/campaign-exception-fair-seed-${run.seed}.json`)});
    expect(config.zoomCampaignException!.roundId).toBe(run.roundId);
    expect(config.jevSpendApproval!.approvalReference).toBe(run.approval);
    expect(config.jevSpendApproval!.campaignCapMicros).toBe(plan.jevCumulativeCapMicros);
    for(const provider of ['jev','zoom','zoom-pro'] as const) {
      expect(config.providers[provider].activationRequested).toBe(false);
      expect(activationBlockers(config,provider,'live').length).toBeGreaterThan(0);
    }
    previous=run.roundId;
  }
});
