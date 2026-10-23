import { constants,openSync,closeSync,writeFileSync,fsyncSync,mkdirSync,mkdtempSync,renameSync,rmSync,rmdirSync } from 'node:fs';
import { resolve,dirname,basename,join } from 'node:path';
/** Publish new artifact files without replacing an existing directory/user file. */
export function writeArtifactDirectory(targetDirectory:string,files:Record<string,string>):string {
  const target=resolve(targetDirectory),parent=dirname(target);mkdirSync(parent,{recursive:true,mode:0o700});
  let reserved=false,published=false,stage:string|undefined;
  try{
    mkdirSync(target,{mode:0o700});reserved=true;stage=mkdtempSync(join(parent,`.${basename(target)}.staging-`));
    for(const [name,text]of Object.entries(files)){
      if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))throw new Error('Invalid artifact filename');
      const fd=openSync(join(stage,name),constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
      try{writeFileSync(fd,text,'utf8');fsyncSync(fd);}finally{closeSync(fd);}
    }
    const fd=openSync(stage,constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}
    renameSync(stage,target);stage=undefined;published=true;return target;
  }catch(error){if(stage)rmSync(stage,{recursive:true,force:true});if(reserved&&!published){try{rmdirSync(target);}catch{/* preserve unexpected user files */}}throw error;}
}
