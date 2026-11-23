// Exercise both report paths after ESM bundling has relocated import.meta.url away from the worker fixtures.
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {expect,test} from 'vitest';
import {openBeliefRecorder} from '../../packages/lab-runtime/src/v2/perception/belief-evidence';
const exec=promisify(execFile);
test('relocated live and retained readers resolve exact profile bytes in the selected worker root',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'relocated-belief-')),worker=resolve('robotics/simulation-mujoco');
 try{
  const profileBytes=await readFile(join(worker,'fixtures/perception-v1/perception-nominal-v1.json'),'utf8'),profile=JSON.parse(profileBytes);
  const identity={runId:'run',bootId:'boot',sceneDigest:'a'.repeat(64),perceptionProfileDigest:profile.digest,recoveryPolicyDigest:null,graspMode:'belief_estimated' as const,seed:7};
  const store=join(dir,'evidence'),rec=await openBeliefRecorder({directory:store,identity,maxBytes:1<<20});await rec.evaluatedThrough(1);await rec.checkpoint();
  const require=createRequire(resolve('apps/tablet-web/package.json')),vite=createRequire(require.resolve('vite/package.json'));
  const {build}=vite('esbuild');
  const reader=join(dir,'reader.mjs');
  await build({entryPoints:[resolve('packages/lab-runtime/src/v2/perception/perception-report.ts')],outfile:reader,bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"}});
  const script=join(dir,'probe.mjs');await writeFile(script,`
import {readFile} from 'node:fs/promises';
import {buildPerceptionReport,buildRetainedPerceptionReport} from './reader.mjs';
const [directory,workerRoot,mode]=process.argv.slice(2),manifest=JSON.parse(await readFile(directory+'/manifest.json','utf8')),id=manifest.identity;
const report=mode==='live'?await buildPerceptionReport(directory,{checkpoint:async()=>{},manifest:()=>manifest},id,workerRoot):
 await buildRetainedPerceptionReport(directory,{seed:id.seed,perception:{graspMode:id.graspMode,profile:{digest:id.perceptionProfileDigest}}},{runId:id.runId,bootId:id.bootId,sceneDigest:id.sceneDigest},workerRoot);
console.log(JSON.stringify(report));
`);
  const read=async(mode:string,root:string)=>JSON.parse((await exec(process.execPath,[script,store,root,mode],{cwd:dir})).stdout);
  const hot=await read('live',worker);expect(hot.issues).toEqual([]);expect(hot.policy.profileBytes).toBe(profileBytes);expect(hot.coverage).toMatchObject({prefixCovered:true,streamFinalized:false});
  await rec.finish(null);const cold=await read('cold',worker);expect(cold.issues).toEqual([]);expect(cold.policy).toEqual(hot.policy);expect(cold.coverage).toMatchObject({prefixCovered:true,streamFinalized:true});
  const missing=await read('cold',dir);expect(missing.issues).toContain('BELIEF_POLICY_UNAVAILABLE');expect(missing.coverage.prefixCovered).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
