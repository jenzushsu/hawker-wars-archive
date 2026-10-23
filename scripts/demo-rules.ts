import { runEpisode } from './offline-episode.js';
import type { DemandScenario } from '../packages/simulation/src/demand.js';
const seedText=process.argv[2]??'0';
if(!/^(?:0|[1-9]\d?)$/.test(seedText))throw new Error('Usage: pnpm demo:rules [development seed 0–99] [clean|bus|rain|supplier-delay]');
const scenario=process.argv[3]??'clean';
if(!['clean','bus','rain','supplier-delay'].includes(scenario)||process.argv.length>4)throw new Error('Unknown scenario/arguments');
const result=runEpisode({seed:Number(seedText),scenario:scenario as DemandScenario});
console.log(JSON.stringify({mode:result.mode,policy:result.policy,completed:result.completed,seed:result.seed,scenario:result.scenario,ticks:result.trace.length,configurationHash:result.configurationHash,scheduleHash:result.scheduleHash,score:result.score,metrics:result.metrics,decisions:result.trace.map(t=>({tick:t.tick,origin:t.decision.origin,action:t.decision.appliedAction,rulePriority:t.decision.rulePriority})),finalHash:result.finalHash,traceHash:result.traceHash,networkCalls:result.networkCalls},null,2));
