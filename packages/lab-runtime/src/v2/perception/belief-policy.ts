/** A display/scoring age bound comes from registered, hash-checked profile bytes. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {PerceptionProfileV1} from '../../../../contracts/generated/navigation2d';
import {loadGraspConfig} from './grasp-config';
export interface BeliefPolicy {ageBasis:'publishedTick';profile:PerceptionProfileV1;profileSha256:string;profileBytes:string}
const ROOT=fileURLToPath(new URL('../../../../../robotics/simulation-mujoco/',import.meta.url));
export async function registeredBeliefPolicy(digest:string|null,workerRoot=ROOT):Promise<BeliefPolicy>{
 const manifest=JSON.parse(await readFile(join(workerRoot,'fixtures/perception-v1/manifest.json'),'utf8')) as {files:{path:string}[]};
 for(const {path}of manifest.files){
  if(!/^perception-(?!regions-)[a-z0-9-]+-v\d+\.json$/.test(path))continue;
  const id=path.slice(0,-5),cfg=await loadGraspConfig(workerRoot,id==='perception-ground-truth-v1'?{graspMode:'belief_ground_truth'}:{graspMode:'belief_estimated',perceptionProfileId:id});
  if(cfg!.profile.digest===digest){const bytes=await readFile(join(workerRoot,'fixtures/perception-v1',path));if(createHash('sha256').update(bytes).digest('hex')!==cfg!.profileSha256)throw Error('BELIEF_POLICY_UNAVAILABLE');return {ageBasis:'publishedTick',profile:cfg!.profile,profileSha256:cfg!.profileSha256,profileBytes:bytes.toString('utf8')};}
 }
 throw Error('BELIEF_POLICY_UNAVAILABLE');
}
