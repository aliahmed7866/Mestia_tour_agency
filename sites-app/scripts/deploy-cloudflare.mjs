import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
if(!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id.includes('REPLACE_')){
  console.error('Set the real D1 database_id in sites-app/wrangler.jsonc before deployment.');
  process.exit(1);
}
const run=(command,args)=>{
  const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
};
run('pnpm',['exec','vite','build','--config','vite.cloudflare.config.ts']);
run('pnpm',['exec','wrangler','deploy','--config','dist/server/wrangler.json']);
