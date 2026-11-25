import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('recorder lint ignores generated SDD bytes while retaining authored violations and real command receipts',()=>{
 const recorder=readFileSync(new URL('../../scripts/record-regression.mjs',import.meta.url),'utf8'),match=/run\('source-lint','source','([^']+)',(\[[^\]]+\])\)/.exec(recorder);expect(match).not.toBeNull();
 const command=match![1]!,args=JSON.parse(match![2]!.replaceAll("'",'"')) as string[],root=mkdtempSync(join(process.env.LAB_LINT_REGRESSION_OUT??tmpdir(),'recorder-lint-'));
 const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
 mkdirSync(join(root,'.superpowers'));writeFileSync(join(root,'.gitignore'),'.superpowers/\n');writeFileSync(join(root,'package.json'),JSON.stringify({private:true,type:'module',scripts:{lint:'eslint .'}}));writeFileSync(join(root,'eslint.config.js'),"export default [{files:['**/*.js'],rules:{'no-debugger':'error'}}];\n");symlinkSync(resolve('../../node_modules'),join(root,'node_modules'),'dir');writeFileSync(join(root,'.superpowers/generated.js'),'debugger;\n');writeFileSync(join(root,'authored.js'),'export const value=1;\n');
 const run=(name:string)=>{const startedAt=new Date().toISOString(),r=spawnSync(command,args,{cwd:root,env:process.env,encoding:'utf8',timeout:15000}),log=(r.stdout??'')+(r.stderr??'');writeFileSync(join(root,name+'.log'),log);writeFileSync(join(root,name+'.receipt.json'),JSON.stringify({command,args,cwd:root,startedAt,finishedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?.message,logBytes:Buffer.byteLength(log),logSha256:sha(log)},null,2));return r;};
 try{const generated=run('generated-only');expect(generated.error).toBeUndefined();expect(generated.status,generated.stdout+generated.stderr).toBe(0);writeFileSync(join(root,'authored.js'),'debugger;\n');const authored=run('authored-violation');expect(authored.error).toBeUndefined();expect(authored.status).toBe(1);expect(authored.stdout+authored.stderr).toContain('authored.js');expect(authored.stdout+authored.stderr).not.toContain('generated.js');}finally{if(!process.env.LAB_LINT_REGRESSION_OUT)rmSync(root,{recursive:true,force:true});}
},40000);
