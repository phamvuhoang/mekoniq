// Run the real owner in a temporary checkout. Every external command is a local fake.
import {afterEach,expect,test} from 'vitest';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

import {ownedCiCheckout} from '../support/owned-ci';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function exercise(mode:string){
 const root=mkdtempSync(join(tmpdir(),'test-owned-'));roots.push(root);
 for(const d of ['bin','tmp'])mkdirSync(join(root,d));
 const cli=ownedCiCheckout(root);
 const fake=(name:string,source:string)=>writeFileSync(join(root,'bin',name),'#!'+process.execPath+'\n'+source,{mode:0o700});
 fake('docker',"if(process.argv[2]==='inspect')console.log('a'.repeat(64));");
 fake('pnpm',`const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),work=args[args.indexOf('--workdir')+1];
 const id=fs.readFileSync(path.join(work,'supabase/config.toml'),'utf8').split('"')[1]; if(!/^mekoniq-ci-[a-f0-9]{16}$/.test(id))process.exit(12);
 fs.appendFileSync(process.env.CALLS,JSON.stringify({args,work,id})+'\\n');
 if(args.includes('status'))console.log(JSON.stringify({DB_URL:'private-test-value',API_URL:'local',ANON_KEY:'local',SERVICE_ROLE_KEY:'local'}));
 if(args.includes('stop')&&process.env.SCENARIO.includes('stop-fail'))process.exit(37);`);
 fake('check',`const fs=require('node:fs');console.log(fs.readFileSync(process.env.MEKONIQ_TEST_SERVICE_RECEIPT,'utf8'));
 if(process.env.SCENARIO==='cancel')process.kill(process.ppid,'SIGTERM');
 if(process.env.SCENARIO==='timeout'||process.env.SCENARIO==='cancel')setTimeout(()=>{},700);
 if(process.env.SCENARIO.startsWith('primary'))process.exit(23);`);
 const stateFile=join(root,'state.json');
 const r=spawnSync(process.execPath,[cli,'--','check'],{cwd:root,encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:join(root,'tmp'),MEKONIQ_OWNED_CI_PARENT:join(root,'tmp'),PATH:join(root,'bin')+':'+process.env.PATH,CALLS:join(root,'calls'),SCENARIO:mode,MEKONIQ_OWNED_CI_STATE:stateFile,MEKONIQ_OWNED_CI_TEST_TIMEOUT_MS:mode==='timeout'?'300':'3000'}});
 const calls=readFileSync(join(root,'calls'),'utf8').trim().split('\n').map(s=>JSON.parse(s));
 expect(calls.map(c=>c.args[2])).toEqual(['start','status','stop']);expect(new Set(calls.map(c=>c.work)).size).toBe(1);
 expect(existsSync(stateFile)).toBe(true);const state=JSON.parse(readFileSync(stateFile,'utf8'));
 expect(state.work).toBe(calls[0].work);expect(state.projectId).toBe(calls[0].id);expect(state.accepted).toBe(false);
 expect(JSON.stringify(state)+r.stdout+r.stderr).not.toContain('private-test-value');
 return {r,state};
}
test.each([['ok',0,0,0],['timeout',124,124,0],['cancel',143,143,0],['stop-fail',37,0,37],['primary-stop-fail',23,23,37]] as const)('owns and reports both child and cleanup outcomes: %s',(mode,overall,primary,cleanup)=>{
 const {r,state}=exercise(mode);expect(r.status).toBe(overall);
 expect(state).toMatchObject({primaryExitCode:primary,stopExitCode:cleanup,cleanup:cleanup===0?'stopped':'failed'});
});
