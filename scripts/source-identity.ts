import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
/** Exact implementation/toolchain/test/input identity, excluding generated result references. */
export function sourceIdentity() {
  const files:string[]=[];
  function walk(relative:string):void {
    for(const entry of readdirSync(join(root,relative),{withFileTypes:true})){
      if(['node_modules','.git','coverage','dist','results','.next','test-results','playwright-report'].includes(entry.name))continue;
      const path=relative?`${relative}/${entry.name}`:entry.name;
      if(entry.isSymbolicLink())throw new Error(`Unexpected source symlink ${path}`);
      if(entry.isDirectory())walk(path);
      else if(entry.isFile()&&path!=='apps/web/next-env.d.ts'&&(path.endsWith('.ts')||path.endsWith('.tsx')||path.endsWith('.css')||path.endsWith('.svg')||path.endsWith('.mjs')||path.endsWith('.sql')||path.endsWith('.sh')||path==='apps/web/vercel.json'||path.startsWith('assets/')||path.startsWith('apps/web/public/art/')||path==='apps/web/public/demo.json'||path==='apps/web/tsconfig.json'||path==='pnpm-lock.yaml'||path==='pnpm-workspace.yaml'||path.endsWith('package.json')||path==='tsconfig.json'||path.startsWith('fixtures/')&&path.endsWith('.json')&&!path.startsWith('fixtures/reference/rules-development-'))){files.push(path);}
    }
  }
  walk('');files.sort();
  const entries=files.map(path=>({path,sha256:createHash('sha256').update(readFileSync(join(root,path))).digest('hex')}));
  const sourceTreeHash=createHash('sha256').update('hawker-wars|p2-a-source-1\n').update(JSON.stringify(entries)).digest('hex');
  const dependencyLockHash=createHash('sha256').update(readFileSync(join(root,'pnpm-lock.yaml'))).digest('hex');
  return {method:'p2-a-source-1',sourceTreeHash,dependencyLockHash,files:entries};
}
