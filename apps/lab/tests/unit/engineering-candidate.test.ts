import {expect,test} from 'vitest';
import {buildEngineeringCandidate} from '../../src/deployment/engineering-bundle';
import {hashJson} from '../../src/twin/hash';
import type {RunReport} from '../../src/scenarios/controls';
import {makeEngineeringProject,makeEngineeringReceipt} from '../support/engineering';

const report=(runId:string,engineering?:{bundleDigest:string;projectDigest:string})=>({manifest:{runId,...engineering?{engineering}:{}},outcome:{status:'completed'}}) as unknown as RunReport;

test('a compiled draft exports its exact digests and only matching evidence counts as current',async()=>{
  const project=makeEngineeringProject(),receipt=makeEngineeringReceipt(project);
  const current=report('run-now',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest});
  const oldProject=report('run-old',{bundleDigest:receipt.bundleDigest,projectDigest:'1'.repeat(64)});
  const oldBundle=report('run-bundle',{bundleDigest:'2'.repeat(64),projectDigest:receipt.projectDigest});
  const s01=report('s01-run');
  const c=await buildEngineeringCandidate(project,receipt,[current,oldProject,oldBundle,s01]);
  expect(c).toMatchObject({documentType:'engineering-candidate',status:'draft',hardwareValidated:false,controlAuthority:false,projectDigest:receipt.projectDigest,bundleDigest:receipt.bundleDigest,assemblyDigest:receipt.assemblyDigest});
  expect(c.evidenceRefs.map(r=>r.runId)).toEqual(['run-now']);
  expect(c.historicalEvidenceRefs.map(r=>[r.runId,r.reason])).toEqual([['run-old','PROJECT_CHANGED'],['run-bundle','BUNDLE_CHANGED'],['s01-run','NOT_ENGINEERING_EVIDENCE']]);
  expect(c.project).toEqual(project);
  const {checksum,...body}=c;expect(checksum).toBe(hashJson(body));
});
test('an edited draft with an old receipt is rejected, not exported as if compiled',async()=>{
  const project=makeEngineeringProject(),receipt=makeEngineeringReceipt(project),edited=structuredClone(project);edited.assembly.instances[0]!.pose.xyzM[0]+=0.1;
  await expect(buildEngineeringCandidate(edited,receipt,[])).rejects.toThrow('ENGINEERING_IDENTITY_MISMATCH');
});
test('no receipt or a blocked receipt still exports the draft with null digests and the blockers',async()=>{
  const project=makeEngineeringProject();
  const none=await buildEngineeringCandidate(project,null,[report('r',{bundleDigest:'3'.repeat(64),projectDigest:hashJson(project)})]);
  expect(none.bundleDigest).toBeNull();expect(none.assemblyDigest).toBeNull();
  expect(none.problems.map(p=>p.code)).toEqual(['BUNDLE_NOT_COMPILED']);
  expect(none.evidenceRefs).toEqual([]);                           // evidence cannot be current without a compiled bundle
  expect(none.historicalEvidenceRefs).toHaveLength(1);
  const blocked={projectDigest:hashJson(project),profile:project.requestedProfile,problems:[{code:'PARAMETER_MISSING',path:'/x',blocking:true,detail:'inertia'}],state:'blocked' as const,bundleDigest:null,assemblyDigest:null,sceneDigest:null,runnable:false as const};
  const c=await buildEngineeringCandidate(project,blocked,[]);
  expect(c.problems).toEqual(blocked.problems);expect(c.bundleDigest).toBeNull();
});
