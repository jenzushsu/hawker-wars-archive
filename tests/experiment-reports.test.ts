import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {relocatePlanningReport} from '../scripts/experiment-reports.ts';
it('preserves the verified report bytes, leaves ledger data intact and is idempotent',()=>{
  const root=mkdtempSync(join(tmpdir(),'hw-report-'));
  try {
    mkdirSync(join(root,'campaign'));
    writeFileSync(join(root,'campaign','ledger.sqlite'),'ledger sentinel');
    const report=JSON.stringify({status:'experiment-completed',before:{attempts:608},after:{attempts:632},results:Array.from({length:24},()=>({roundId:'577bb9e5-36df-49e1-895c-880e66d656ee'}))});
    writeFileSync(join(root,'campaign','planning-experiment.json'),report);
    expect(relocatePlanningReport(root)).toBe(true);
    expect(readFileSync(join(root,'reports','planning-experiment.json'),'utf8')).toBe(report);
    expect(readFileSync(join(root,'campaign','ledger.sqlite'),'utf8')).toBe('ledger sentinel');
    expect(relocatePlanningReport(root)).toBe(false);
  }finally{rmSync(root,{recursive:true,force:true});}
});
it('refuses to move an unrecognized report',()=>{
  const root=mkdtempSync(join(tmpdir(),'hw-report-'));
  try {
    mkdirSync(join(root,'campaign'));
    const source=join(root,'campaign','planning-experiment.json');writeFileSync(source,'{}');
    expect(()=>relocatePlanningReport(root)).toThrow('Unexpected historical report');
    expect(existsSync(source)).toBe(true);
  }finally{rmSync(root,{recursive:true,force:true});}
});
