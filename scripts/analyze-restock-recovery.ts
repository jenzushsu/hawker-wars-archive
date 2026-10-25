import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createInitialFrame,prepareTick,applyAction,advanceTick,settle} from '../packages/simulation/src/engine.ts';
import {createDemandSchedule,arrivalsAt,toEngineArrival,eventAt} from '../packages/simulation/src/demand.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {scoreState} from '../packages/simulation/src/scoring.ts';
import {proposeRestockRecovery,MIN_RECOVERY_SERVICE_TICKS,RESTOCK_RECOVERY_VERSION} from '../packages/decisions/src/restock-recovery-proposal.ts';
import type {DecisionInput} from '../packages/shared/src/index.ts';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const campaigns=[...[7,11,23].map(seed=>({name:`v3-seed-${seed}`,seed,prefix:`docs/deployment/evidence/fair-120-tick/seed-${seed}-`})),{name:'v4-seed-23',seed:23,prefix:'docs/deployment/evidence/v4-full/'}];
const results=[];
for(const campaign of campaigns){
 const rows=read(campaign.prefix+'decisions.json'),expected=read(campaign.prefix+'analysis.json');
 for(const policy of ['rules','jev','zoom','zoom-pro']){
  const choices=rows.filter((r:any)=>r.policy===policy).sort((a:any,b:any)=>a.tick-b.tick);
  if(choices.length!==120||choices.some((r:any,i:number)=>r.tick!==i))throw new Error('Incomplete recording');
  const schedule=createDemandSchedule(campaign.seed,'clean');let frame=createInitialFrame();const proposals=[];
  for(let tick=0;tick<120;tick++){
   if(frame.stage==='committed')frame=advanceTick(frame);
   const promo=frame.state.promotion,event=eventAt(schedule,tick),arrivals=arrivalsAt(schedule,tick,!!promo&&promo.startsAt<=tick&&promo.endsAt>=tick).map(toEngineArrival);
   frame=prepareTick(frame,event?{arrivals,event}:{arrivals});
   const input=decisionInput(frame.state,'11111111-1111-4111-8111-111111111111',choices.slice(Math.max(0,tick-5),tick).map((r:any)=>({tick:r.tick,action:r.action}))),action=choices[tick].action as DecisionInput['legalActions'][number];
   const proposal=proposeRestockRecovery(input,action);
   if(proposal)proposals.push({tick,selectedAction:action,cashCents:input.observation.cashCents,queue:input.observation.queue.length,...proposal});
   // Shadow only: always execute the recorded action, never the proposal.
   frame=applyAction(frame,action);
  }
  frame=settle(advanceTick(frame));const e=expected.find((e:any)=>e.policy===policy);
  if(JSON.stringify(scoreState(frame.state))!==JSON.stringify(e.score)||JSON.stringify(frame.state.totals)!==JSON.stringify(e.totals))throw new Error('Original trajectory changed');
  results.push({campaign:campaign.name,policy,recordedProfitCents:e.score.profitCents,recordedUtility:e.score.utilityPoints,firstProposalTick:proposals[0]?.tick??null,proposals});
 }
}
const report={version:RESTOCK_RECOVERY_VERSION,minServiceTicks:MIN_RECOVERY_SERVICE_TICKS,mode:'offline-shadow',providerCalls:0,decisionsExamined:1920,caveat:'Flag counts are opportunities on original trajectories, not the number of interventions in a changed run. No hypothetical model decisions or scores are inferred after a proposed intervention.',results};
mkdirSync('docs/deployment/evidence/restock-recovery',{recursive:true});writeFileSync('docs/deployment/evidence/restock-recovery/shadow.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(results.map(r=>({campaign:r.campaign,policy:r.policy,first:r.firstProposalTick,flags:r.proposals.length})),null,2));
