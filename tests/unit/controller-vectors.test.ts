import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
// @ts-expect-error vector generator is an executable ESM script
import {generateControllerVectors} from '../../scripts/generate-controller-vectors.mjs';
import {diffDriveBaseV1} from '../../packages/lab-runtime/src/v2/control/diff-drive-base';
import {jointTrajectoryFollowerV1} from '../../packages/lab-runtime/src/v2/control/joint-follower';
import type {MotionController} from '../../packages/lab-runtime/src/v2/control/controller';

const DIR='tests/fixtures/control/';
interface Vectors {controller:{id:string;revision:number};cases:{name:string;config:never;steps:{input:{tick:number;setpoint:never;feedback:never[]};expected:{commands:unknown[];events:unknown[]}}[]}[]}
const read=async(name:string)=>JSON.parse(await readFile(DIR+name,'utf8')) as Vectors;

test('the committed vectors are what the generator writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'controller-vectors-'));
 try{
  const names=await generateControllerVectors(dir) as string[];
  expect(names).toEqual(['diff-drive-base-v1.vectors.json','joint-trajectory-follower-v1.vectors.json']);
  for(const n of names)expect(await readFile(join(dir,n),'utf8'),n).toBe(await readFile(DIR+n,'utf8'));
 }finally{await rm(dir,{recursive:true,force:true});}
});
const replay=<S,P,C>(controller:MotionController<S,P,C>,v:Vectors)=>{
 expect(v.controller).toEqual({id:controller.id,revision:controller.revision});
 for(const c of v.cases){
  let state=controller.init(c.config as C);
  for(const [i,s] of c.steps.entries()){
   const r=controller.step(state,s.input as never);state=r.state;
   expect({commands:r.commands,events:r.events},`${c.name} step ${i}`).toEqual(s.expected);
  }
 }
};
test('replaying the diff-drive-base-v1 vectors gives every command and event',async()=>replay(diffDriveBaseV1,await read('diff-drive-base-v1.vectors.json')));
test('replaying the joint-trajectory-follower-v1 vectors gives every command and event',async()=>replay(jointTrajectoryFollowerV1,await read('joint-trajectory-follower-v1.vectors.json')));
test('the vectors cover enable, run, never-enabled, tracking loss and fault for each controller',async()=>{
 const codes=async(n:string)=>new Set((await read(n)).cases.flatMap(c=>c.steps.flatMap(s=>s.expected.events.map(e=>(e as {code:string}).code))));
 expect(await codes('diff-drive-base-v1.vectors.json')).toEqual(new Set(['DRIVE_FAULT','DRIVE_NOT_READY','TRACKING_DEGRADED']));
 expect(await codes('joint-trajectory-follower-v1.vectors.json')).toEqual(new Set(['DRIVE_FAULT','DRIVE_NOT_READY','ARM_FOLLOWING_ERROR']));
 const v=await read('diff-drive-base-v1.vectors.json'),quiet=v.cases.find(c=>c.name==='quantised-encoder-at-rest')!;
 expect(quiet.steps.flatMap(s=>s.expected.events)).toEqual([]);  // a resting quantised encoder never raises an event
});
