// V11: what a run's grasp mode resolves to on the server: a registered, digest-checked perception profile, the registered regions, and the grasp frames relative to the cup.
import {cp,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {expect,test} from 'vitest';
import {graspOffsetsFrom,loadGraspConfig} from '../../packages/lab-runtime/src/v2/perception/grasp-config';
const root=resolve('robotics/simulation-mujoco');
test('the fixed program and an absent mode resolve to nothing: the run is the R2b run',async()=>{
 expect(await loadGraspConfig(root,{})).toBeUndefined();expect(await loadGraspConfig(root,{graspMode:'fixed_program'})).toBeUndefined();
});
test('ground truth resolves to the error-free profile, an estimated belief to the named one, both with their digests and the regions',async()=>{
 const gt=await loadGraspConfig(root,{graspMode:'belief_ground_truth'}),est=await loadGraspConfig(root,{graspMode:'belief_estimated',perceptionProfileId:'perception-sigma-5mm-v1'});
 expect(gt).toMatchObject({mode:'belief_ground_truth',profile:{id:'perception-ground-truth-v1',sigmaM:[0,0],latencyTicks:0},beliefWaitTicks:250});
 expect(est).toMatchObject({mode:'belief_estimated',profile:{id:'perception-sigma-5mm-v1',sigmaM:[0.005,0.005]}});
 expect(est!.profile.digest).toMatch(/^[0-9a-f]{64}$/);expect(est!.regions.view.supportId).toBe('nozzle-stand');expect(est!.regions.workHalfExtentM).toEqual([0.02,0.02]);
});
test('an unregistered id, a path-like id and an estimated belief without a profile are refused',async()=>{
 await expect(loadGraspConfig(root,{graspMode:'belief_estimated',perceptionProfileId:'perception-nope-v1'})).rejects.toThrow('PERCEPTION_PROFILE_NOT_REGISTERED');
 await expect(loadGraspConfig(root,{graspMode:'belief_estimated',perceptionProfileId:'perception-../../x-v1'})).rejects.toThrow('PERCEPTION_PROFILE_NOT_REGISTERED');
 await expect(loadGraspConfig(root,{graspMode:'belief_estimated'})).rejects.toThrow('PERCEPTION_PROFILE_REQUIRED');
});
test('a profile whose bytes no longer match the fixture manifest, or whose digest is wrong, is refused',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'grasp-config-'));await cp(join(root,'fixtures/perception-v1'),join(dir,'fixtures/perception-v1'),{recursive:true});
 const f=join(dir,'fixtures/perception-v1/perception-nominal-v1.json'),doc=JSON.parse(await readFile(f,'utf8'));
 await writeFile(f,JSON.stringify({...doc,sigmaM:[0.001,0.001]},null,2)+'\n');
 await expect(loadGraspConfig(dir,{graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'})).rejects.toThrow('PERCEPTION_FIXTURE_HASH_MISMATCH');
});
test('the grasp frames are offsets from the cup: the pick is 22 mm past and 1 mm under the cup centre, the approach is 0.12 m back along the tool axis, the lift 0.15 m up',()=>{
 const layout={grasp:{approachM:0.12,liftM:0.15,pick:{position:[0.512,0,0.15],quaternionXyzw:[0,Math.SQRT1_2,0,Math.SQRT1_2]}}};
 const o=graspOffsetsFrom(layout as never,[0.49,0,0.151]);
 expect(o.pick.positionM[0]).toBeCloseTo(0.022,9);expect(o.pick.positionM[2]).toBeCloseTo(-0.001,9);
 expect(o.pickApproach.positionM[0]).toBeCloseTo(0.022-0.12,9);expect(o.lift.positionM[2]).toBeCloseTo(-0.001+0.15,9);
 expect(o.pick.quaternionXyzw).toEqual(layout.grasp.pick.quaternionXyzw);
});
test('a registered two-stage program resolves only in belief mode and keeps the original work and view bounds',async()=>{
 const g=await loadGraspConfig(root,{graspMode:'belief_ground_truth',graspProgramId:'cup-pick-two-stage-v1'});
 expect(g!.program).toMatchObject({id:'cup-pick-two-stage-v1',revision:1,calibration:'not_calibrated',pickInsetM:0.02,captureM:0.07});
 expect(g!.program!.digest).toMatch(/^[0-9a-f]{64}$/);expect(g!.regions.workHalfExtentM).toEqual([0.02,0.02]);
 expect((await loadGraspConfig(root,{graspMode:'belief_ground_truth'}))!.program).toBeUndefined();
 for(const mode of [undefined,'fixed_program'])await expect(loadGraspConfig(root,{graspMode:mode,graspProgramId:'cup-pick-two-stage-v1'})).rejects.toThrow('GRASP_PROGRAM_NOT_ALLOWED');
 await expect(loadGraspConfig(root,{graspMode:'belief_ground_truth',graspProgramId:'cup-pick-two-stage-v2'})).rejects.toThrow('GRASP_PROGRAM_NOT_REGISTERED');
});
test.each([
 [[0,Math.SQRT1_2,0,Math.SQRT1_2],[0.002,0,-0.001],[-0.098,0,-0.001]],
 [[-Math.SQRT1_2,0,0,Math.SQRT1_2],[0.022,-0.02,-0.001],[0.022,-0.12,-0.001]],
])('the registered insertion shift follows the tool axis while the approach stays fixed (%s)',async(q,pick,approach)=>{
 const g=await loadGraspConfig(root,{graspMode:'belief_ground_truth',graspProgramId:'cup-pick-two-stage-v1'});
 const layout={grasp:{approachM:0.12,liftM:0.15,pick:{position:[0.512,0,0.15],quaternionXyzw:q}}};
 const offsets=graspOffsetsFrom(layout as never,[0.49,0,0.151],g!.program);
 for(let i=0;i<3;i++){expect(offsets.pick.positionM[i]).toBeCloseTo(pick[i]!,9);expect(offsets.pickApproach.positionM[i]).toBeCloseTo(approach[i]!,9);expect(offsets.lift.positionM[i]).toBeCloseTo(pick[i]!+(i===2?0.15:0),9);}
 expect(offsets.pick.quaternionXyzw).toEqual(q);
});
