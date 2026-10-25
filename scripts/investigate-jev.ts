/** Offline counterfactuals: no network, provider calls or live policy changes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createInitialFrame, prepareTick, applyAction, advanceTick, settle } from '../packages/simulation/src/engine.ts';
import { createDemandSchedule, arrivalsAt, toEngineArrival, eventAt } from '../packages/simulation/src/demand.ts';
import { decisionInput } from '../packages/simulation/src/observation.ts';
import { scoreState } from '../packages/simulation/src/scoring.ts';
import { chooseRules, type Action } from '../packages/decisions/src/rules.ts';
import { buildRequest, parseResponse } from '../packages/providers/src/wire.ts';

const rows = JSON.parse(readFileSync('docs/deployment/evidence/prompt-v2/v2-decisions.json', 'utf8')) as {policy:string; tick:number; action:Action}[];
const recorded = rows.filter(r => r.policy === 'jev').sort((a,b) => a.tick-b.tick);
if (recorded.length !== 120 || recorded.some((r,i) => r.tick !== i)) throw new Error('Incomplete history');
const modes = ['recorded', 'restock-only-at-57', 'rules-from-57', 'wait-at-57-then-rules'] as const;
let captured: ReturnType<typeof decisionInput> | undefined;
const capturedStates: ReturnType<typeof decisionInput>[] = [];
const outcomes = modes.map(mode => {
  const schedule = createDemandSchedule(7, 'clean');
  let frame = createInitialFrame();
  const history: {tick:number; action:Action}[] = [];
  for (let tick=0; tick<120; tick++) {
    if (frame.stage === 'committed') frame = advanceTick(frame);
    const p = frame.state.promotion;
    const arrivals = arrivalsAt(schedule,tick,!!p && p.startsAt<=tick && p.endsAt>=tick).map(toEngineArrival);
    const event = eventAt(schedule,tick);
    frame = prepareTick(frame,event ? {arrivals,event} : {arrivals});
    const input = decisionInput(frame.state,'32b5d1e3-f6a2-4e0b-a5c0-38cec0c3a863',history.slice(-5));
    if (mode === 'recorded' && tick === 57) captured = input;
    if (mode === 'recorded' && [26,57,95,109].includes(tick)) capturedStates.push(input);
    let action = recorded[tick]!.action;
    if (mode === 'restock-only-at-57' && tick === 57) action = 'RESTOCK';
    if ((mode === 'rules-from-57' && tick >= 57) || (mode === 'wait-at-57-then-rules' && tick > 57)) action = chooseRules(input.observation,input.legalActions).action;
    if (!input.legalActions.includes(action)) throw new Error(`Illegal ${mode}:${tick}:${action}`);
    history.push({tick,action});
    frame = applyAction(frame,action);
  }
  frame = settle(advanceTick(frame));
  return {mode,score:scoreState(frame.state),totals:frame.state.totals,actionsAfterStockout:history.slice(57)};
});
if (!captured) throw new Error('Missing captured state');
if (outcomes[0]!.score.profitCents !== 10600 || outcomes[0]!.score.utilityPoints !== 870) throw new Error('Replay mismatch');
const input = captured;
const raw = {model:'jev-1.13.0',answers:{action:{type:'choice',choice:'RESTOCK',probabilities:Object.fromEntries(input.legalActions.map((a,i) => [a,i === 0 ? 0.99 : 0]))}}};
let roundedMetadataResult = 'unexpected-success';
try { parseResponse('jev',input,'jev-1.13.0',raw,100); } catch (e) { roundedMetadataResult = (e as Error).message; }
const withoutProbabilities = {model:'jev-1.13.0',answers:{action:{type:'choice',choice:'RESTOCK'}}};
const report = {
  scope:'Offline seed-7 counterfactuals; continuations are rules or recorded actions, not predictions of Jev.',
  stockoutInput:input,
  capturedStates,
  reconstructedPromptV2Request:buildRequest('jev',input,'jev-1.13.0'),
  parserReproduction:{synthetic:true,roundedMetadataResult,withoutProbabilities:parseResponse('jev',input,'jev-1.13.0',withoutProbabilities,100).result.action},
  outcomes,
};
writeFileSync('docs/deployment/evidence/prompt-v2/jev-investigation.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({stockout:input.observation,parser:report.parserReproduction,outcomes:outcomes.map(({mode,score,totals})=>({mode,score,totals}))},null,2));
