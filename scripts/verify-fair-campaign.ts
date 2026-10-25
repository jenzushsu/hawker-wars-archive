import {readFileSync,writeFileSync} from 'node:fs';
import {ProviderRuntimeSchema} from '../packages/providers/src/activation.ts';
import {providerConfigurationHash} from '../packages/live/src/multi-runtime.ts';
const read=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const plan=read('docs/providers/fair-campaign-plan.json');
const directory='docs/deployment/evidence/fair-120-tick';
const rounds:any[]=[];
let previousAttempts=674;
for(const run of plan.runs) {
  const prefix=`${directory}/seed-${run.seed}`;
  const database=read(prefix+'-database.json'),decisions=read(prefix+'-decisions.json');
  const analyses=read(prefix+'-analysis.json'),receipt=read(prefix+'-receipt.json');
  const config=ProviderRuntimeSchema.parse({...read(`manifests/provider-runtime-fair-seed-${run.seed}.json`),zoomCampaignException:read(`manifests/campaign-exception-fair-seed-${run.seed}.json`)});
  if(database.id!==run.roundId||database.seed!==run.seed||database.status!=='completed'||database.tick!==120||database.sequence!==121||database.published!==false||database.providerConfigurationHash!==providerConfigurationHash(config))throw new Error('Round identity or completion mismatch');
  if(database.events.count!==121||database.events.unique_ticks!==121||database.events.unique_sequences!==121||database.events.closing_events!==1||decisions.length!==480)throw new Error('Event or decision coverage mismatch');
  const accounting=receipt.accounting;
  if(receipt.preparation.before.attempts!==previousAttempts||receipt.preparation.after.attempts!==previousAttempts)throw new Error('Ledger continuity mismatch');
  let calls=0;
  const providers=[];
  for(const policy of ['rules','jev','zoom','zoom-pro']) {
    const analysis=analyses.find((a:any)=>a.policy===policy),score=database.scores.find((s:any)=>s.policy_id===policy);
    if(!analysis||!score||analysis.seed!==run.seed||analysis.score.profitCents!==score.profit_cents||analysis.score.utilityPoints!==score.utility_points||analysis.closingCashCents!==score.cash_cents||analysis.totals.served!==score.served||analysis.totals.abandoned!==score.abandoned)throw new Error('Replay/database score mismatch');
    const choices=decisions.filter((d:any)=>d.policy===policy).sort((a:any,b:any)=>a.tick-b.tick);
    if(choices.length!==120||choices.some((d:any,i:number)=>d.tick!==i))throw new Error('Missing/duplicate decision');
    const usage=accounting.usage.runs.filter((u:any)=>u.run_id===run.roundId&&u.provider===policy);
    const actualCalls=usage.reduce((n:number,u:any)=>n+u.attempts,0);
    const noDispatchFallbacks=receipt.errors.filter((e:any)=>e.status==='provider-fallback'&&e.provider===policy&&e.attemptCount===0);
    if(noDispatchFallbacks.some((e:any)=>!choices.some((d:any)=>d.tick===e.tick&&d.fallback===e.reason)))throw new Error('Fallback log/decision mismatch');
    const skippedTicks=new Set(noDispatchFallbacks.map((e:any)=>e.tick));
    const expectedCalls=policy==='rules'?0:choices.filter((d:any)=>d.source!=='forced_wait'&&!skippedTicks.has(d.tick)).length;
    if(actualCalls!==expectedCalls)throw new Error('Provider call reconciliation failed');
    calls+=actualCalls;
    providers.push({policy,profitCents:score.profit_cents,utilityPoints:score.utility_points,served:score.served,abandoned:score.abandoned,wasted:analysis.totals.wasted,waitMinutes:analysis.totals.waitMinutes,restocks:analysis.restockTicks.length,emptyStockWaitsWithRestockAvailable:analysis.emptyStockWaitsWithRestockAvailable.length,waitsWithServeAvailable:analysis.waitsWithServeAvailable.length,waitsWithCookAvailable:analysis.waitsWithCookAvailable.length,forcedWaits:analysis.forcedWaits,voluntaryWaits:analysis.voluntaryWaits,providerCalls:actualCalls,fallbacks:analysis.fallbacks,usage});
  }
  if(accounting.summary.attempts!==previousAttempts+calls)throw new Error('Cumulative records mismatch');
  for(const pool of accounting.summary.pools)if(pool.reservedMicros>pool.capMicros)throw new Error('Budget cap exceeded');
  const get=(summary:any,id:string)=>summary.pools.find((p:any)=>p.id===id).reservedMicros;
  const jevReservedMicros=get(accounting.summary,'jev-separate')-get(receipt.preparation.before,'jev-separate');
  const zoomAllocatedMicros=get(accounting.summary,'zoom-shared')-get(receipt.preparation.before,'zoom-shared');
  if(jevReservedMicros!==providers.find(p=>p.policy==='jev')!.providerCalls*2753||zoomAllocatedMicros!==providers.filter(p=>p.policy.startsWith('zoom')).reduce((n,p)=>n+p.providerCalls,0)*1000||zoomAllocatedMicros>250000)throw new Error('Run reservation mismatch');
  previousAttempts=accounting.summary.attempts;
  rounds.push({seed:run.seed,roundId:run.roundId,providers,calls,jevReservedMicros,zoomAllocatedMicros,errors:receipt.errors,ledger:accounting.summary,verification:{scoresMatchReplay:true,completeDecisionCoverage:true,callsReconciled:true}});
}
const summarize=(selected:any[])=>['rules','jev','zoom','zoom-pro'].map(policy=>{
  const rows=selected.map(r=>r.providers.find((p:any)=>p.policy===policy)!);
  const mean=(key:'profitCents'|'utilityPoints'|'served'|'abandoned'|'wasted')=>rows.reduce((n,r)=>n+r[key],0)/rows.length;
  return {policy,meanProfitCents:mean('profitCents'),meanUtilityPoints:mean('utilityPoints'),meanServed:mean('served'),meanAbandoned:mean('abandoned'),meanWasted:mean('wasted')};
});
const averages=summarize(rounds);
const fallbackFreeRounds=rounds.filter(r=>r.providers.every((p:any)=>p.fallbacks.length===0));
const report={status:'completed',promptVersion:plan.promptVersion,scope:'Three private clean-seed full 120-tick rounds; rounds with fallbacks are not pure model comparisons. No general model ranking claim.',rounds,averages,fallbackFreeSeeds:fallbackFreeRounds.map(r=>r.seed),fallbackFreeAverages:fallbackFreeRounds.length?summarize(fallbackFreeRounds):[],newProviderCalls:previousAttempts-674,finalLedger:rounds.at(-1)!.ledger};
writeFileSync(directory+'/comparison.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({averages,newProviderCalls:report.newProviderCalls,finalLedger:report.finalLedger},null,2));
