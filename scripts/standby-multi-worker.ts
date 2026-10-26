import {writeFileSync,unlinkSync} from 'node:fs';
import {createInitialFrame,prepareTick} from '../packages/simulation/src/engine.ts';
import {decisionInput} from '../packages/simulation/src/observation.ts';
import {buildRequest,PROVIDER_PROMPT_VERSION} from '../packages/providers/src/wire.ts';

// Deployment-only readiness check. No datastore, ledger, credentials or dispatch.
const input=decisionInput(prepareTick(createInitialFrame()).state,'11111111-1111-4111-8111-111111111111');
const requests=(['jev','zoom','zoom-pro'] as const).map(provider=>buildRequest(provider,input,'jev-1.13.0'));
const bytes=requests.map(r=>Buffer.byteLength(JSON.stringify(r.body)));
if(PROVIDER_PROMPT_VERSION!=='hawker-decision-prompt-4'||bytes.some(n=>n>8192)||requests[0]!.body.state!==requests[1]!.body.input||requests[1]!.body.input!==requests[2]!.body.input)throw new Error('Standby wire readiness check failed');
writeFileSync('/tmp/hawker-standby-ready',PROVIDER_PROMPT_VERSION);
console.log(JSON.stringify({status:'standby-ready',promptVersion:PROVIDER_PROMPT_VERSION,requestBytes:bytes,providerDispatch:false}));
const timer=setInterval(()=>{},60_000);
const stop=()=>{clearInterval(timer);unlinkSync('/tmp/hawker-standby-ready');};
process.once('SIGTERM',stop);process.once('SIGINT',stop);
