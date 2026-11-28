#!/usr/bin/env node
// CI preflight: start each pinned engine worker once, through the probe the runtime itself uses, so a missing interpreter, package or engine is one named
// failure before the suites instead of a hundred missing reports inside them. Installs nothing. Exit 0 every named engine answered, 1 one did not, 2 usage.
//   node scripts/engine-preflight.mjs irsim|mujoco|webots|algorithm ...
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const load=(p)=>tsImport(`../packages/lab-runtime/src/${p}.ts`,import.meta.url);
const worker=(venv,dir,directory)=>{const workerRoot=join(root,'robotics',dir);return {enabled:true,python:join(root,venv,'bin/python'),workerRoot,lockPath:join(workerRoot,'requirements.lock'),directory};};
/** Each probe returns the reason the engine is unusable, or undefined. */
const PROBES={
 irsim:async(d)=>(await (await load('v2/navigation2d/readiness')).portableSimulationFromOptions(worker('.venv-irsim','navigation-2d',d))).unavailable,
 mujoco:async(d)=>(await (await load('v2/simulation3d/mujoco')).mujocoFromOptions(worker('.venv-mujoco','simulation-mujoco',d))).arm.capability.reason,
 webots:async(d)=>(await (await load('v2/simulation3d/readiness')).webotsFromOptions({...worker('.venv-webots','simulation-3d',d),webotsHome:process.env.MEKONIQ_WEBOTS_HOME??'/Applications/Webots.app'})).capability.reason,
 // a one-joint pose: the checker is one process per request, so a real call is its start-up
 algorithm:async()=>{const {createAlgorithmChecker}=await load('v2/algorithm/checker');
  await createAlgorithmChecker({python:join(root,'.venv-algorithm/bin/python'),root:join(root,'robotics/algorithm')}).call('rtb_fk',{dh:[{a:0,alpha:0,d:0,offset:0}],q:[[0]]});},
};
const keys=process.argv.slice(2);
if(!keys.length||keys.some(k=>!Object.hasOwn(PROBES,k))){console.error(`usage: engine-preflight.mjs ${Object.keys(PROBES).join('|')} ...`);process.exit(2);}
let failed=false;
for(const key of keys){
 const dir=await mkdtemp(join(tmpdir(),'engine-preflight-'));
 let reason;
 try{reason=await PROBES[key](dir);}catch(e){reason=e instanceof Error?e.message:String(e);}finally{await rm(dir,{recursive:true,force:true});}
 console.log(reason?`ENGINE_UNAVAILABLE ${key}: ${reason}`:`OK ${key}`);
 failed||=!!reason;
}
process.exit(failed?1:0);
