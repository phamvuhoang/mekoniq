// Final review I2: what an ARM03 record and the arm block say about the arm. A not-run record names the model of the run's arm plant; on the MuJoCo arm both say that the project's
// arm entity references the Lab's illustrative design asset, not the simulated arm. Mock and Webots records are unchanged (PUMA, no note).
import { expect, test } from 'vitest';
import Ajv from 'ajv';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import armSchema from '../../packages/contracts/schemas/lab-arm-collision-evidence.schema.json';
import { MockArmPlant, type ArmPlantState } from '../../packages/cell-adapters/src/mock-arm';
import { armCollisionRecord, buildArmReport } from '../../packages/lab-runtime/src/v2/beverage/arm-plant-report';
import type { ArmPlantReport } from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import { PUMA560_SI, XARM6_SI } from '../../packages/lab-runtime/src/v2/models/arm-kinematics';

const world = { id: 'w', revision: 1, hash: 'a'.repeat(64) }, asset = { id: 'arm-puma-reference', revision: 1, contentHash: 'c'.repeat(64) };
const validate = new Ajv({ strict: true, allErrors: true }).compile(armSchema);
const arm = (plantId?: ArmPlantState['plantId']) => ({ ...MockArmPlant.initial('arm-1'), ...plantId ? { plantId } : {} });

test('a not-run ARM03 record names the model of the run\'s arm plant; only the MuJoCo arm\'s says the asset is the design reference, not the simulated arm', () => {
  for (const [plantId, model] of [[undefined, PUMA560_SI], ['webots_arm', PUMA560_SI], ['mujoco_arm', XARM6_SI]] as const) {
    const r = armCollisionRecord(arm(plantId), world, asset);
    expect(r).toMatchObject({ result: 'not_run', reasonCodes: ['TRACE_EMPTY'], modelRevision: model.revision, assetRef: asset });
    expect(validate(r), JSON.stringify(validate.errors)).toBe(true);
    if (plantId !== 'mujoco_arm') { expect('assetNote' in r).toBe(false); continue; }
    for (const s of ['arm-puma-reference', 'illustrative design asset', 'not the simulated arm', 'xarm6-g2-v1', XARM6_SI.id, XARM6_SI.revision]) expect(r.assetNote).toContain(s);
  }
});

test('the MuJoCo arm block carries the same statement in its notes; a Webots block has no notes and no note on its record', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arm-report-'));
  try {
    const plant = (engine: string) => ({ engine, tracking: { samples: 0, peakRad: [], rmsRad: [] } }) as unknown as ArmPlantReport;
    const cell = { waypoints: { digest: 'd', table: [] }, allowedContacts: [], releaseTimeoutTicks: 200, notes: ['cell note'] };
    const mj = await buildArmReport(arm('mujoco_arm'), plant('mujoco_3d'), directory, world, asset, cell);
    expect(mj.notes).toEqual(['cell note', mj.collision.assetNote]);
    const wb = await buildArmReport(arm('webots_arm'), plant('webots_3d'), directory, world, asset);
    expect(wb.notes).toBeUndefined(); expect(wb.collision.assetNote).toBeUndefined(); expect(wb.collision.modelRevision).toBe(PUMA560_SI.revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a stationary allowed-pair change creates a new sweep interval and cannot hide a newly forbidden contact',async()=>{
 const {PUMA_PROGRAMS}=await import('../../packages/cell-adapters/src/mock-arm'),{DEFAULT_ARM_GEOMETRY}=await import('../../packages/lab-runtime/src/v2/models/arm-collision'),{forwardKinematics}=await import('../../packages/lab-runtime/src/v2/models/arm-kinematics'),{qrotate}=await import('../../packages/lab-runtime/src/v2/frames');
 const programs={...structuredClone(PUMA_PROGRAMS),collision:{geometry:{...DEFAULT_ARM_GEOMETRY,gripperLengthM:.12},allowedPairs:[['gripper','fixture']] as [string,string][]}},state=MockArmPlant.initial('arm'),plant=new MockArmPlant(state,()=>0,()=> 'boot',{take:()=>null,put:()=>{}},()=>null,PUMA560_SI,{reachTolRad:.01,settleTicks:1,followTolRad:.1,followTicks:5},programs);
 const tcp=forwardKinematics(PUMA560_SI,state.q).tcp,offset=qrotate(tcp.quaternionXyzw,[0,0,.1]),center=tcp.position.map((v,i)=>v+offset[i]!) as [number,number,number];
 plant.setCollisionScene({available:true,scope:'self_scene_robot',revision:'w',profileRevision:1,tick:1,world:[{id:'fixture',kind:'sphere',center,radiusM:.001}],robotPoses:[]});
 plant.advance();plant.observe(state.q,[]);expect(state.stop?.latched).not.toBe(true);expect(state.collision!.last!.allowed!.inContact).toEqual([['gripper','fixture']]);
 programs.collision.allowedPairs=[['held-cup','fixture']];plant.advance();plant.observe(state.q,[]);expect(state.stop?.reason).toBe('ARM_COLLISION');expect(state.collision!.evidence!.intervals).toHaveLength(2);expect(state.collision!.evidence!.intervals.map(i=>i.result.ok)).toEqual([true,false]);
});
test('world contact report keeps the measured phase intervals and region; legacy constant pairs keep their old note',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'world-arm-report-'));try{
 const s=arm('mujoco_arm') as ArmPlantState;s.tracking={gen:s.q,settled:0,followCount:0,samples:2,peakRad:s.q.map(()=>0),sumSq:s.q.map(()=>0),trace:[{tick:10,actualRad:s.q,commandedRad:s.q},{tick:29,actualRad:s.q,commandedRad:s.q}]};
 const result=(pair:[string,string])=>({ok:true,engine:'capsule-sweep-v1' as const,modelRevision:XARM6_SI.revision,geometryRevision:'g',toleranceM:.0005,evaluations:3,allowed:{pairs:[pair],inContact:[pair]}});
 s.collision={world:[],checks:20,last:null,evidence:{droppedIntervals:0,worlds:{},intervals:[{firstTick:10,lastTick:19,fromQ:s.q,toQ:s.q,heldCupId:null,worldRevision:'w',sceneRevision:'s',result:result(['gripper','support/nozzle-stand'])},{firstTick:20,lastTick:29,fromQ:s.q,toQ:s.q,heldCupId:'cup-1',worldRevision:'w',sceneRevision:'s',result:result(['gripper','amr-1/tray-1/plate/c0'])}]}};
 const cell={waypoints:{digest:'d',table:[]},allowedContactPolicy:'phase_region_v1',allowedContacts:[{a:'gripper',b:'nozzle-stand',phase:'grasp',regionId:'nozzle-stand',sweepPair:['gripper','support/nozzle-stand']},{a:'gripper',b:'amr-1/tray-1',phase:'release',regionId:'amr-1/tray-1',sweepPair:['gripper','amr-1/tray-1/plate/c0']}],releaseTimeoutTicks:200,notes:[]};
 const plant={engine:'mujoco_3d',tracking:{samples:2,peakRad:s.q.map(()=>0),rmsRad:s.q.map(()=>0)}} as unknown as ArmPlantReport;
 const r=await buildArmReport(s,plant,directory,world,asset,cell as never);expect(r.collision.allowedContacts.map(c=>[c.phase,c.fromTick,c.toTick])).toEqual([['grasp',10,19],['release',20,29]]);expect(r.collision.allowedContactsNote).toContain('phase');expect(r.collision.allowedContactsNote).not.toContain('static');expect(armCollisionRecord(s,world,asset).allowedContactsNote).toContain('static');
 }finally{await rm(directory,{recursive:true,force:true});}
});
