import {DatabaseSync} from 'node:sqlite';
import {existsSync,readFileSync} from 'node:fs';
const directory='/var/lib/hawker/campaign';
try {
 const db=new DatabaseSync(directory+'/ledger.sqlite',{readOnly:true});
 const row=db.prepare('SELECT configuration FROM metadata WHERE id=1').get() as {configuration:string};
 const config=JSON.parse(row.configuration);
 console.log(JSON.stringify({status:'ledger-inspection',dispatch:false,configurationHash:config.configurationHash,allowedRunId:config.allowedRunId,attempts:db.prepare('SELECT COUNT(*) AS count FROM attempts').get(),pools:db.prepare('SELECT pool_id,reserved_micros FROM pools').all()}));
 const path='/var/lib/hawker/reports/short-plan-experiment.json';
 if(existsSync(path))console.log(JSON.stringify({status:'saved-short-plan-report',report:JSON.parse(readFileSync(path,'utf8'))}));
 db.close();
} catch(e) {console.error(JSON.stringify({status:'inspection-error',code:(e as {code?:string}).code ?? 'unknown'}));}
setInterval(()=>{},30000);
