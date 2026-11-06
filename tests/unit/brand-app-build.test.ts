import {test,expect} from 'vitest';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('filtered app builds validate canonical and public releases before compiling',()=>{
 const temp=mkdtempSync(join(tmpdir(),'brand-app-build-'));
 try{
  mkdirSync(join(temp,'scripts'));for(const name of ['check-brand.mjs','brand-check.cjs'])cpSync('scripts/'+name,join(temp,'scripts',name));
  cpSync('packages/ui/brand',join(temp,'packages/ui/brand'),{recursive:true});
  for(const app of ['cloud-web','tablet-web']){
   const cwd=join(temp,'apps',app);mkdirSync(join(cwd,'public'),{recursive:true});cpSync('packages/ui/brand',join(cwd,'public/brand'),{recursive:true});
   const scripts=JSON.parse(readFileSync('apps/'+app+'/package.json','utf8')).scripts;
   expect(scripts.build.startsWith('npm run check:brand && ')).toBe(true);
   const check=()=>spawnSync('/bin/sh',['-c',scripts['check:brand']],{cwd,encoding:'utf8'});
   expect(check().status).toBe(0);
   const publicCss=join(cwd,'public/brand/components.css'),bytes=readFileSync(publicCss);writeFileSync(publicCss,Buffer.concat([bytes,Buffer.from('drift')]));expect(check().status).toBe(1);writeFileSync(publicCss,bytes);
   const canonicalCss=join(temp,'packages/ui/brand/tokens.css'),canonicalBytes=readFileSync(canonicalCss);writeFileSync(canonicalCss,Buffer.concat([canonicalBytes,Buffer.from('drift')]));expect(check().status).toBe(1);writeFileSync(canonicalCss,canonicalBytes);
  }
 }finally{rmSync(temp,{recursive:true,force:true});}
});
