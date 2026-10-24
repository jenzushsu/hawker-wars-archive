import {createHash} from 'node:crypto';
import {mkdirSync,existsSync,openSync,writeFileSync,fsyncSync,closeSync,chownSync,chmodSync} from 'node:fs';
import {openLedger} from '../packages/providers/src/ledger.ts';
import {makeLedgerConfig,readRuntimeConfig} from './provider-config.ts';
// Operator-only provisioning service. Never part of worker startup.
const root='/var/lib/hawker/campaign',path=root+'/ledger.sqlite';
if(existsSync(root))throw new Error('Refusing to replace existing campaign storage');
const encoded=process.env.HAWKER_LEDGER_SNAPSHOT_BASE64,expected=process.env.HAWKER_LEDGER_SNAPSHOT_SHA256;
if(!encoded||!expected||encoded.length>4_000_000)throw new Error('Pinned snapshot required');
const bytes=Buffer.from(encoded,'base64');
if(createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error('Snapshot digest mismatch');
mkdirSync(root,{mode:0o700});const fd=openSync(path,'wx',0o600);
try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
const ledger=openLedger(root,makeLedgerConfig(readRuntimeConfig()));
try{ledger.validateStorage();console.log(JSON.stringify({status:'imported-existing-ledger',summary:ledger.summary()}));}finally{ledger.close();}
chownSync(path,1000,1000);chmodSync(path,0o600);chownSync(root,1000,1000);chmodSync(root,0o700);
const parent=openSync('/var/lib/hawker','r');try{fsyncSync(parent);}finally{closeSync(parent);}
