import {expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runProbeCommand} from '../../scripts/native-sim/mujoco-probe-process.mjs';
// @ts-expect-error tooling ESM
import * as current from '../../scripts/native-sim/r2b-process.mjs';
test('historical bound stays 30 minutes and current policy refuses noninteger, infinite, and excessive deadlines',async()=>{
 await expect(runProbeCommand('unused',[],{timeoutMs:1800001,out:'/unused'})).rejects.toThrow('PROBE_DEADLINE_REQUIRED');
 for(const timeoutMs of [0,1.5,Infinity,6100001])await expect(current.runR2bCaseCommand('unused',[],{timeoutMs})).rejects.toThrow('R2B_CASE_DEADLINE_REQUIRED');
});
test('current timeout retains actual incremental output and owned child exit receipt',async()=>{
 const out=await mkdtemp(join(tmpdir(),'r2b-owned-process-'));try{const r=await current.runR2bCaseCommand(process.execPath,['-e',"process.stdout.write('retained');setInterval(()=>{},1000)"],{out,timeoutMs:2000});expect(r.reason).toBe('timeout');expect(await readFile(join(out,'stdout.log'),'utf8')).toBe('retained');expect(JSON.parse(await readFile(join(out,'process.json'),'utf8')).exitSignal).toBe('SIGTERM');}finally{await rm(out,{recursive:true,force:true});}
});

test('current abort retains output and output-limit keeps the observed prefix without affecting a sibling process',async()=>{
 const {spawn}=await import('node:child_process'),sibling=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),roots:string[]=[];
 try{const aborted=await mkdtemp(join(tmpdir(),'r2b-abort-'));roots.push(aborted);const abort=new AbortController(),poll=setInterval(async()=>{if((await readFile(join(aborted,'stdout.log'),'utf8').catch(()=>'')).length){clearInterval(poll);abort.abort();}},20),cap=setTimeout(()=>abort.abort(),5000);try{expect(await current.runR2bCaseCommand(process.execPath,['-e',"process.stdout.write('started');setInterval(()=>{},1000)"],{out:aborted,timeoutMs:6000,signal:abort.signal})).toMatchObject({status:'incomplete',reason:'aborted'});}finally{clearInterval(poll);clearTimeout(cap);}expect(await readFile(join(aborted,'stdout.log'),'utf8')).toBe('started');
 const limited=await mkdtemp(join(tmpdir(),'r2b-limit-'));roots.push(limited);expect(await current.runR2bCaseCommand(process.execPath,['-e',"process.stdout.write('0123456789');setInterval(()=>{},1000)"],{out:limited,timeoutMs:2000,maxBytes:5})).toMatchObject({status:'incomplete',reason:'output_limit'});expect(await readFile(join(limited,'stdout.log'),'utf8')).toBe('01234');expect(sibling.exitCode).toBeNull();
 }finally{sibling.kill('SIGTERM');await new Promise<void>(r=>sibling.once('close',()=>r()));for(const p of roots)await rm(p,{recursive:true,force:true});}
});
