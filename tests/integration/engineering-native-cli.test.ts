import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const python=process.env.ENGINEERING_PYTHON??(existsSync('.venv/bin/python')?resolve('.venv/bin/python'):'python3');
const compilerAvailable=spawnSync(python,['-c','import yaml,rfc8785,jsonschema'],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:5000,stdio:'ignore'}).status===0;
// Missing portable compiler dependencies make this check not_run, never native evidence.
test.skipIf(!compilerAvailable)('public engineering CLI keeps relative and absolute project identity through the real compiler and runtime argv',()=>{
 const directory=mkdtempSync(join(tmpdir(),'engineering-cli-')),relative='robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json',absolute=resolve(relative);
 const manifests:string[]=[];
 try{
  for(const [index,project] of [relative,absolute].entries()){
   const out=join(directory,String(index)),trace=join(directory,`trace-${index}.json`);
   const result=spawnSync(process.execPath,['--import',resolve('tests/support/engineering-cli-probes.mjs'),'scripts/lab-sil.mjs','run','--scenario','FD01','--seed','17','--repeat','1','--out',out,'--backend-set','engineering-rigid-v1','--environment-profile','engineering-amd64','--engineering-project',project],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',ENGINEERING_PYTHON:python,ENGINEERING_CLI_TRACE:trace},encoding:'utf8',timeout:30000});
   expect(result.status,result.stdout+result.stderr).toBe(0);
   const calls=JSON.parse(readFileSync(trace,'utf8')) as {kind:string;args:string[];cwd?:string}[];
   expect(calls.map(c=>c.kind)).toEqual(['compiler','runtime']);
   expect(calls[0].args[calls[0].args.indexOf('--project')+1]).toBe(absolute);
   expect(calls[0].cwd).toBe(resolve('robotics/simulation'));
   expect(calls[1].args[calls[1].args.indexOf('--fixture')+1]).toBe(absolute);
   manifests.push(readFileSync(join(out,'run-1/bundle/compiler-manifest.json'),'utf8'));
  }
  expect(manifests[0]).toBe(manifests[1]);
 }finally{rmSync(directory,{recursive:true,force:true});}
},70000);
