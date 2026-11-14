import {expect,test} from 'vitest';
import {resolve} from 'node:path';
import {readWorldFixture} from '../../packages/lab-runtime/src/v2/simulation3d/world-scene';
import {prepareWorldAdmission} from '../../packages/lab-runtime/src/v2/simulation3d/world-evidence';
import {evaluateWorldSweep} from '../../packages/lab-runtime/src/v2/simulation3d/world-sweep';
import {tick} from '../support/physics';
import type {WorldEvidenceRecord} from '../../packages/contracts/generated/navigation2d';
import type {WorldControl} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
const idle:WorldControl={version:1,program:null,attachmentProxyPropId:null,movementInterlocked:false,stopLatched:false};
async function fixture(count:number,q?:number[]){const f=await readWorldFixture(resolve('robotics/simulation-mujoco'),'coffee-delivery-cell-v1'),admission=prepareWorldAdmission(f.scene,f.files),records:WorldEvidenceRecord[]=[];
 for(let n=0;n<=count;n++){const p=tick(n),x=.35+n*1e-7,y=.48591366218667575,quat=[0,0,Math.SQRT1_2,Math.SQRT1_2];p.loads=[];p.contacts=[];for(const b of p.base){b.robotId='amr-1';b.poseMap={positionM:[x,y,.09],quaternionXyzw:quat};b.rollRad=0;b.pitchRad=0;}for(const w of p.wheels)w.robotId='amr-1';for(const o of p.odometry){o.robotId='amr-1';o.poseDriveMap=[x,y,Math.PI/2];}
 records.push({snapshot:{schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(n+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'world-unit',bootId:'world-boot',seq:String(n+1),tick:n,simTimeNs:String(n*20_000_000),sceneDigest:f.scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[x,y,Math.PI/2],bodyVelocity:[0,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:q??f.scene.armCell.arm.homeRad,velocitiesRadS:Array(6).fill(0),collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:[],physics:p},command:n?{targetTick:n,velocities:[{robotId:'amr-1',vMps:0,omegaRadps:0}],actorUpdates:[],jointTargets:[{armId:'arm-1',positionsRad:q??f.scene.armCell.arm.homeRad}],gripperTargets:[{armId:'arm-1',openingM:.0889}],propPlacements:[],worldControl:structuredClone(idle)}:null,interactions:[]});}
 return {admission,records,authority:{runId:'world-unit',bootId:'world-boot',sceneDigest:f.scene.sceneDigest,lastCommittedTick:count,businessEpochMs:0},journal:[]};
}
test('world full sweep covers more than4096 changing admitted geometry intervals without the legacy cache',async()=>{
 const h=await fixture(4100),r=evaluateWorldSweep(h.records,h.admission,h.journal,h.authority,true);expect(r.status).toBe('pass');expect(r.geometry).toMatchObject({status:'pass',checkedIntervals:4100,expectedIntervals:4100});expect(r.geometry.distinctSceneRevisions).toBeGreaterThan(4096);expect(r.nativeContacts.status).toBe('pass');
},120000);
test('missing/tampered context, missing journal binding, incomplete prefix and wrong Source horizon never pass',async()=>{
 const h=await fixture(2);delete h.records[1]!.command!.worldControl;expect(evaluateWorldSweep(h.records,h.admission,[],h.authority,true).status).toBe('not_run');
 const g=await fixture(2);g.records[1]!.command!.worldControl={...idle,movementInterlocked:true,program:{commandId:'c',transferId:'t',cupId:'cup-1',sourceEventId:'missing:0',payloadHash:'0'.repeat(64),controlEpoch:1,programId:'cup-place',stage:0,waypoint:'high'}};expect(evaluateWorldSweep(g.records,g.admission,[],g.authority,true).reasonCodes).toContain('WORLD_CONTROL_SOURCE_MISMATCH');
 const good=await fixture(2);expect(evaluateWorldSweep(good.records,good.admission,[],good.authority,false).status).toBe('not_run');expect(evaluateWorldSweep(good.records,good.admission,[],{...good.authority,lastCommittedTick:3},true).status).toBe('not_run');
});
test('same actual support contact becomes forbidden across the Source program phase boundary',async()=>{
 const f=await readWorldFixture(resolve('robotics/simulation-mujoco'),'coffee-delivery-cell-v1'),programs=JSON.parse(Buffer.from(f.files.get('programs.json')!).toString()).programs,h=await fixture(2,programs.waypoints.pick);
 h.records[1]!.command!.worldControl={...idle,movementInterlocked:true,program:{commandId:'c',transferId:'t',cupId:'cup-1',sourceEventId:'source:0',payloadHash:'0'.repeat(64),controlEpoch:1,programId:'cup-pick',stage:1,waypoint:'pick'}};
 const journal=[{entryId:'source',organizationId:'lab-world-unit',venueId:'simulation',recordedAt:new Date(0).toISOString(),payload:{events:[{type:'CupTransferRequested',data:{kind:'cup',id:'cup-1',state:{pendingTransfer:{commandId:'c',transferId:'t',payloadHash:'0'.repeat(64),controlEpoch:1,to:{kind:'arm',id:'arm-1'}}}}}]}}];
 const r=evaluateWorldSweep(h.records,h.admission,journal,h.authority,true);expect(r.geometry.checkedIntervals).toBe(2);expect(r.status).toBe('fail');expect(r.geometry.firstFailure?.tick).toBe(2);expect(r.geometry.firstFailure?.pair).toContain('support/nozzle-stand');
});
test('direct sweep review rejects oversized observations and Source journals before geometric work',async()=>{
 const h=await fixture(1);(h.records[1] as unknown as {padding:string}).padding='x'.repeat(256*1024);
 const rows=evaluateWorldSweep(h.records,h.admission,[],h.authority,true);expect(rows.reasonCodes).toContain('WORLD_SWEEP_READ_LIMIT');expect(rows.geometry.checkedIntervals).toBe(0);
 const g=await fixture(1),entry={entryId:'j',organizationId:'lab-world-unit',venueId:'simulation',recordedAt:new Date(0).toISOString(),payload:{events:[]}};
 const journal=evaluateWorldSweep(g.records,g.admission,Array(10001).fill(entry),g.authority,true);expect(journal.reasonCodes).toContain('WORLD_SOURCE_JOURNAL_READ_LIMIT');expect(journal.geometry.checkedIntervals).toBe(0);
});
