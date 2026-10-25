import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {DecisionInputSchema,type DecisionInput} from '../packages/shared/src/index.ts';
import {buildRequest} from '../packages/providers/src/wire.ts';
import {buildActionCriteriaRequest,actionCriteriaInstructions,ACTION_CRITERIA_VERSION} from '../packages/providers/src/action-criteria-experiment.ts';
const read=(p:string)=>JSON.parse(readFileSync(p,'utf8'));
const inputs:DecisionInput[]=[...read('docs/deployment/evidence/jev114-comparison/result.json').decisions.map((d:any)=>d.input),...read('manifests/pipeline-validation-inputs.json')].map((i:unknown)=>DecisionInputSchema.parse(i));
const summary={version:ACTION_CRITERIA_VERSION,states:inputs.length,forcedWaits:0,requests:0,maxRequestBytes:{jev:0,zoom:0,'zoom-pro':0},instructionCharacters:{baselineMaximum:0,candidateMaximum:0},providerDispatch:false,examples:[] as {tick:number;instructions:string}[]};
for(const input of inputs){
 if(input.legalActions.length===1){summary.forcedWaits++;continue;}
 const texts=[];
 for(const p of ['jev','zoom','zoom-pro'] as const){
  const base=buildRequest(p,input,'jev-1.13.0'),candidate=buildActionCriteriaRequest(p,input,'jev-1.13.0');
  const bytes=Buffer.byteLength(JSON.stringify(candidate.body));if(bytes>8192)throw new Error('Shared request limit exceeded');summary.maxRequestBytes[p]=Math.max(summary.maxRequestBytes[p],bytes);summary.requests++;
  const q=p==='jev'?(candidate.body.questions as any).action:(candidate.body.questions as any)[0],old=p==='jev'?(base.body.questions as any).action:(base.body.questions as any)[0];
  texts.push(q.instructions);summary.instructionCharacters.baselineMaximum=Math.max(summary.instructionCharacters.baselineMaximum,old.instructions.length);summary.instructionCharacters.candidateMaximum=Math.max(summary.instructionCharacters.candidateMaximum,q.instructions.length);
  q.instructions=old.instructions;if(JSON.stringify(candidate)!==JSON.stringify(base))throw new Error('Context/choices/model mutated');
 }
 if(new Set(texts).size!==1)throw new Error('Unequal model instructions');
}
for(const tick of [31,32,59,109])summary.examples.push({tick,instructions:actionCriteriaInstructions(inputs.find(i=>i.tick===tick)!)});
mkdirSync('docs/deployment/evidence/action-criteria',{recursive:true});writeFileSync('docs/deployment/evidence/action-criteria/offline.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,examples:undefined},null,2));
