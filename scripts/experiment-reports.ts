import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';

/** Recover the known prior reporting bug without deleting or modifying ledger data. */
export function relocatePlanningReport(root:string):boolean {
  const source=join(root,'campaign','planning-experiment.json');
  if(!existsSync(source))return false;
  const stat=lstatSync(source);
  if(!stat.isFile() || stat.isSymbolicLink())throw new Error('Report is not a regular file');
  const report=JSON.parse(readFileSync(source,'utf8'));
  if(report.status!=='experiment-completed' || report.before?.attempts!==608 || report.after?.attempts!==632 || report.results?.length!==24 || report.results.some((r:{roundId:string})=>!['b7e8b014-2415-48f0-8bfd-5365a228e2c4','577bb9e5-36df-49e1-895c-880e66d656ee'].includes(r.roundId)))throw new Error('Unexpected historical report');
  const destination=join(root,'reports');
  mkdirSync(destination,{recursive:true,mode:0o700});
  if(lstatSync(destination).isSymbolicLink())throw new Error('Reports directory cannot be a symlink');
  const target=join(destination,'planning-experiment.json');
  if(existsSync(target))throw new Error('Refusing to overwrite retained report');
  renameSync(source,target);
  return true;
}
