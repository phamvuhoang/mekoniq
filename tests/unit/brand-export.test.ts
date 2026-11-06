import {test,expect} from 'vitest';
import {cpSync,realpathSync,mkdtempSync,readFileSync,writeFileSync,mkdirSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const run=(script:string,...args:string[])=>spawnSync(process.execPath,['scripts/'+script,...args],{encoding:'utf8'});
test('safe deterministic export and standalone receipt verification',()=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'brand-'));const dir=join(temp,'brand');
 try{expect(run('export-brand.mjs','--target',dir).status).toBe(0);const receipt=readFileSync(join(dir,'release.json'),'utf8');expect(run('export-brand.mjs','--target',dir).status).toBe(0);expect(readFileSync(join(dir,'release.json'),'utf8')).toBe(receipt);
 expect(run('check-brand.mjs','--dir',dir).status).toBe(0);
 for(const path of ['assets/MEKONIQ_Icon_Transparent.svg','fonts/JetBrainsMono-500.woff2']){const p=join(dir,path),b=readFileSync(p);writeFileSync(p,Buffer.concat([b,Buffer.from('x')]));expect(run('check-brand.mjs','--dir',dir).status).toBe(1);writeFileSync(p,b);}
 const manifest=JSON.parse(receipt);for(const path of ['../escape','/absolute','assets/../escape']){const bad=structuredClone(manifest);bad.files[0].path=path;writeFileSync(join(dir,'release.json'),JSON.stringify(bad));expect(run('check-brand.mjs','--dir',dir).status).toBe(1);}
 manifest.files.push(manifest.files[0]);writeFileSync(join(dir,'release.json'),JSON.stringify(manifest));expect(run('check-brand.mjs','--dir',dir).status).toBe(1);writeFileSync(join(dir,'release.json'),receipt);
 writeFileSync(join(dir,'keep.txt'),'keep');expect(run('export-brand.mjs','--target',dir).status).toBe(1);expect(readFileSync(join(dir,'keep.txt'),'utf8')).toBe('keep');rmSync(join(dir,'keep.txt'));
 rmSync(join(dir,'fonts/JetBrainsMono-500.woff2'));expect(run('check-brand.mjs','--dir',dir).status).toBe(1);
 const outside=join(temp,'outside');mkdirSync(outside);writeFileSync(join(outside,'safe'),'safe');symlinkSync(outside,join(temp,'link'));expect(run('export-brand.mjs','--target',join(temp,'link','brand')).status).toBe(1);expect(readFileSync(join(outside,'safe'),'utf8')).toBe('safe');
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('committed content cannot reuse an existing release version',()=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'brand-version-'));
 const exec=(cmd:string,args:string[])=>spawnSync(cmd,args,{cwd:temp,encoding:'utf8'});
 try{
 mkdirSync(join(temp,'scripts'));mkdirSync(join(temp,'packages/ui'),{recursive:true});
 cpSync('packages/ui/brand',join(temp,'packages/ui/brand'),{recursive:true});
 for(const p of ['export-brand.mjs','brand-check.cjs'])cpSync('scripts/'+p,join(temp,'scripts',p));
 exec('git',['init']);exec('git',['config','user.email','fixture@example.invalid']);exec('git',['config','user.name','Fixture']);exec('git',['add','.']);exec('git',['commit','-m','fixture']);
 writeFileSync(join(temp,'packages/ui/brand/README.md'),'Changed canonical content');exec('git',['add','.']);exec('git',['commit','-m','change']);
 const result=exec(process.execPath,['scripts/export-brand.mjs','--target',join(temp,'out')]);expect(result.status).toBe(1);expect(result.stderr).toContain('Bump brandVersion');
 }finally{rmSync(temp,{recursive:true,force:true});}
});
