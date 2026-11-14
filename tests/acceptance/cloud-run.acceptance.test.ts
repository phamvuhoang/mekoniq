import {expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {checkCloudRunEvidence} from '../../scripts/cloud-run-qualification.mjs';
// @ts-expect-error plain ESM script without types
import {checkQualification} from '../../scripts/sim-extension-qualification.mjs';

test('G-CLOUD1: CL01 supplements a valid R2a qualification of the same runtime and Lab pin, without accepting or rewriting it',()=>{
 const cloud=process.env.LAB_CLOUD_EVIDENCE_DIR,base=process.env.LAB_SIMEXT_EVIDENCE_DIR;
 expect(cloud,'LAB_CLOUD_EVIDENCE_DIR must select a recorded Cloud Run deployment').toBeTruthy();
 expect(base,'LAB_SIMEXT_EVIDENCE_DIR must select its R2a qualification').toBeTruthy();
 const reader=(root:string)=>(path:string)=>{try{return readFileSync(join(root,path));}catch{return null;}};
 const readBase=reader(base!),bytes=readBase('qualification.json');expect(bytes).toBeTruthy();
 expect(checkQualification(JSON.parse(bytes!.toString()),readBase)).toEqual([]);
 expect(checkCloudRunEvidence(reader(cloud!),bytes)).toEqual([]);
 console.log('G-CLOUD1 tested by CL01 supplement; accepted:false; original R2a qualification unchanged');
});
