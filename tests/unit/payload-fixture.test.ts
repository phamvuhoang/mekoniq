import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
// @ts-expect-error fixture generator is an executable ESM script
import {generatePayloadFixture} from '../../scripts/generate-payload-fixture.mjs';
import {validateLoadProfile} from '../../packages/lab-runtime/src/v2/simulation3d/load-profile';
test('generation is byte deterministic and preserves canonical geometry while fitting the offset cup',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'payload-fixture-'));
 try{await generatePayloadFixture(join(dir,'a'));await generatePayloadFixture(join(dir,'b'));
 const names=await readdir(join(dir,'a'));expect(names).toContain('dock-feasibility.json');
 for(const name of names){const bytes=await readFile(join(dir,'a',name));expect(bytes.equals(await readFile(join(dir,'b',name)))).toBe(true);expect(bytes.equals(await readFile(join('robotics/simulation-mujoco/fixtures/serve-payload-v1',name)))).toBe(true);}
 for(const name of ['empty','cup-center','cup-offset'])expect(validateLoadProfile(JSON.parse(await readFile(join(dir,'a',name+'.json'),'utf8'))).ok).toBe(true);
 const cup=JSON.parse(await readFile(join(dir,'a/cup-offset.json'),'utf8'));expect(cup.props[0].massKg).toBe(0.32);expect(cup.props[0].attachment.initialPoseInSupport.positionM).toEqual([0,0.05,0.05]);
 const model=await readFile(join(dir,'a/physical-model-amr-1.json'));expect(model.equals(await readFile('robotics/simulation-3d/fixtures/serve-3d-v1/physical-model-amr-1.json'))).toBe(true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('dock evidence solves the actual xArm mobile target and retains the cell sweep gate',async()=>{
 const dock=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-payload-v1/dock-feasibility.json','utf8'));
 expect(dock.ik.execution).toBe('ran');expect(dock.ik.modelId).toBe('xarm6-reference');
 expect(typeof dock.ik.positionResidualM).toBe('number');expect(typeof dock.ik.orientationResidualRad).toBe('number');
 expect(dock.legacyWaypointsReachable).toBe(false);expect(dock.legacyWaypointPositionResidualM).toBeGreaterThan(0.4);
 expect(dock.proposedFixtureDiff.apply).toBe(false);expect(dock.sweep.execution).toBe('not_run');expect(dock.blocksCell).toBe(true);expect(dock.blocksAMROnly).toBe(false);
});

test('profile assumptions resolve to hashed fixture bytes rather than unrecorded prose',async()=>{
 const dir='robotics/simulation-mujoco/fixtures/serve-payload-v1';
 const profile=JSON.parse(await readFile(join(dir,'cup-center.json'),'utf8'));
 const ref=profile.props[0].sources.friction;
 expect(ref.documentId).toBe('serve-payload-v1/assumptions.json');
 const bytes=await readFile(join(dir,'assumptions.json'));expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.contentSha256);
});
