import {expect,test} from 'vitest';
// @ts-expect-error ESM tooling
import {currentR2bSubjectIssues} from '../../scripts/native-sim/r2b-subject.mjs';
const tuple={sourceCommit:'a'.repeat(40),runtimeArtifactSha256:'b'.repeat(64),schemaHash:'c'.repeat(64),portableClosureHash:'d'.repeat(64)};
test('current subject rejects historical profiles, unbuilt/wrong images and mismatched packaged closure identities',()=>{
 const h={subject:{...tuple,executionKind:'mujoco_image',image:{platform:'linux/amd64',configDigest:'sha256:'+'e'.repeat(64),manifestDigest:'sha256:'+'f'.repeat(64)}},profile:{documents:{kind:'mujoco_cell_v1'},architecture:'amd64'}},p={version:1,kind:'r2b-payload-cell-package',...tuple,portableToolsDigest:tuple.portableClosureHash,bundleSha256:'a'.repeat(64),campaigns:['payload-v1','mj-cell-bv01-v1'],inputs:[{}],imageFiles:[{}]};
 expect(currentR2bSubjectIssues(h,p)).toEqual([]);expect(currentR2bSubjectIssues({...h,profile:{...h.profile,documents:{kind:'mujoco_r2a_arm_v1'}}},p)).toContain('R2B_CURRENT_PROFILE_REQUIRED');
 expect(currentR2bSubjectIssues({...h,subject:{...h.subject,image:null}},p)).toContain('R2B_IMAGE_UNBUILT');
 for(const key of ['sourceCommit','runtimeArtifactSha256','schemaHash','portableToolsDigest','bundleSha256'])expect(currentR2bSubjectIssues(h,{...p,[key]:'wrong'})).toContain('R2B_CAMPAIGN_PACKAGE_MISMATCH');
});

// @ts-expect-error ESM tooling
import {currentPackageBindingIssues} from '../../scripts/native-sim/r2b-subject.mjs';
import {createHash} from 'node:crypto';
test('OCI config labels bind exact package bytes and bundle separately; coherent changed observer/tuple still fails its boundary',()=>{
 const h='a'.repeat(64),pkg={version:1,kind:'r2b-payload-cell-package',sourceCommit:'a'.repeat(40),runtimeArtifactSha256:h,schemaHash:h,portableToolsDigest:h,campaigns:['payload-v1','mj-cell-bv01-v1'],imageFiles:['payload-v1','mj-cell-bv01-v1'].map(id=>({path:'robotics/simulation-mujoco/campaigns/'+id+'.json',bytes:1,sha256:h})),documentProfile:'mujoco_cell_v1',bundleSha256:h,engineObserverSha256:h,payloadRegistrySha256:h,cellRegistrySha256:h,inputs:['scripts/r2b-campaign-entry.ts','scripts/native-sim/r2b-engine-inventory.py','packages/sync/migrations/sqlite/001_journal.sql'].map(path=>({path,bytes:10,sha256:h}))},bytes=Buffer.from(JSON.stringify(pkg)),labels={'org.mekoniq.r2b.campaign-package-sha256':createHash('sha256').update(bytes).digest('hex'),'org.mekoniq.r2b.campaign-bundle-sha256':h},config={config:{Labels:labels}},inspect={Config:{Labels:labels}};
 expect(currentPackageBindingIssues(bytes,config,inspect)).toEqual([]);
 for(const key of Object.keys(labels)){const changed={...labels,[key]:'b'.repeat(64)};expect(currentPackageBindingIssues(bytes,{config:{Labels:changed}},{Config:{Labels:changed}}).some((x:string)=>x.startsWith('R2B_ADMITTED_CONFIG_LABEL'))).toBe(true);expect(currentPackageBindingIssues(bytes,config,{Config:{Labels:changed}}).some((x:string)=>x.startsWith('R2B_INSPECT_LABEL'))).toBe(true);}
 const mutated={...pkg,engineObserverSha256:'b'.repeat(64)},newBytes=Buffer.from(JSON.stringify(mutated)),resealed={...labels,'org.mekoniq.r2b.campaign-package-sha256':createHash('sha256').update(newBytes).digest('hex')};expect(currentPackageBindingIssues(newBytes,{config:{Labels:resealed}},{Config:{Labels:resealed}})).toContain('R2B_OBSERVER_GRAPH');
});
test('coherently resealed registry hashes must still match the packaged image file graph',()=>{
 const h='a'.repeat(64),pkg={version:1,kind:'r2b-payload-cell-package',sourceCommit:'a'.repeat(40),runtimeArtifactSha256:h,schemaHash:h,portableToolsDigest:h,campaigns:['payload-v1','mj-cell-bv01-v1'],imageFiles:['payload-v1','mj-cell-bv01-v1'].map(id=>({path:'robotics/simulation-mujoco/campaigns/'+id+'.json',bytes:1,sha256:h})),documentProfile:'mujoco_cell_v1',bundleSha256:h,engineObserverSha256:h,payloadRegistrySha256:h,cellRegistrySha256:h,inputs:['scripts/r2b-campaign-entry.ts','scripts/native-sim/r2b-engine-inventory.py','packages/sync/migrations/sqlite/001_journal.sql'].map(path=>({path,bytes:10,sha256:h}))};
 const assess=(p:typeof pkg)=>{const bytes=Buffer.from(JSON.stringify(p)),labels={'org.mekoniq.r2b.campaign-package-sha256':createHash('sha256').update(bytes).digest('hex'),'org.mekoniq.r2b.campaign-bundle-sha256':h};return currentPackageBindingIssues(bytes,{config:{Labels:labels}},{Config:{Labels:labels}});};expect(assess(pkg)).toEqual([]);for(const key of ['cellRegistrySha256','payloadRegistrySha256'])expect(assess({...pkg,[key]:'b'.repeat(64)})).toContain('R2B_REGISTRY_GRAPH');
});
