import {expect,test} from 'vitest';
// @ts-expect-error plain ESM script without types
import {boundedEvidenceRead} from '../../scripts/r2b-readback.mjs';
// @ts-expect-error plain ESM script without types
import {verifyR4Directory} from '../../scripts/r4-readback.mjs';
// @ts-expect-error plain ESM script without types
import {verifyR5Directory} from '../../scripts/r5-readback.mjs';
// @ts-expect-error plain ESM script without types
import {checkCloudRunEvidence,checkCloudRunR4Evidence,checkCloudRunR5Evidence} from '../../scripts/cloud-run-qualification.mjs';
// @ts-expect-error plain ESM script without types
import {checkQualification} from '../../scripts/sim-extension-qualification.mjs';

test('a Cloud Run supplement passes its own release and base qualification checks',async()=>{
 const cloud=process.env.LAB_CLOUD_EVIDENCE_DIR,base=process.env.LAB_SIMEXT_EVIDENCE_DIR;
 expect(cloud,'LAB_CLOUD_EVIDENCE_DIR must select a recorded Cloud Run deployment').toBeTruthy();
 expect(base,'LAB_SIMEXT_EVIDENCE_DIR must select its base qualification').toBeTruthy();
 const reader=(root:string)=>(path:string)=>{try{return boundedEvidenceRead(root,path);}catch{return null;}};
 const readBase=reader(base!),bytes=readBase('qualification.json');expect(bytes).toBeTruthy();
 const record=JSON.parse(bytes!.toString());expect(['r5','r4','r2a']).toContain(record.release);
 if(record.release==='r5'){
  // CLD06: the R5 record keeps CLD06 not_run (deploy_order_pending); the supplement binds to its exact bytes
  expect(await verifyR5Directory(base!)).toEqual([]);
  expect(checkCloudRunR5Evidence(reader(cloud!),bytes)).toEqual([]);
 }else if(record.release==='r4'){
  expect(await verifyR4Directory(base!)).toEqual([]);
  expect(checkCloudRunR4Evidence(reader(cloud!),bytes)).toEqual([]);
 }else{
  expect(checkQualification(record,readBase)).toEqual([]);
  expect(checkCloudRunEvidence(reader(cloud!),bytes)).toEqual([]);
 }
},1200000); // R4 and R5 re-verify the full nested evidence directory.
