import {existsSync} from 'node:fs';
import {afterEach,describe,expect,test,vi} from 'vitest';
import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {openCell,cellUntil} from '../support/mujoco-cell';
import {act} from '../support/lab-v2';
import * as workerClient from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import {evaluateWorldSweep} from '../../packages/lab-runtime/src/v2/simulation3d/world-sweep';
import {WorkerLostError} from '../../packages/lab-runtime/src/v2/navigation2d/plant';
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('shared world native checks (requires .venv-mujoco)',()=>{
afterEach(()=>vi.restoreAllMocks());
const held=(v:Awaited<ReturnType<Awaited<ReturnType<typeof openCell>>['run']['snapshot']>>)=>v.coffee?.cups.some(c=>c.cupId==='cup-1'&&c.ownerKind==='arm')??false;
for(const presetId of ['world-dock-drift-v1','world-cup-fall-v1'] as const)test(`registered native disturbance ${presetId} preserves last Source custody and never serves`,async()=>{
 const h=await openCell(7,presetId,{cellDisturbance:{presetId,cupId:'cup-1'}});let saved!:Awaited<ReturnType<typeof h.save>>;
 try{await h.run.start();await cellUntil(h.run,()=>false,8000,25);saved=await h.save('fault');console.log('B06 disturbance',JSON.stringify({directory:h.directory,presetId,outcome:saved.report.outcome,attention:saved.report.attention,stop:saved.report.coffee?.armTrace.stop}));}
 finally{await h.run.close();expect(h.processes.processes()).toEqual([]);}
 const read=await h.readback(),{report}=saved;await writeFile(join(h.directory,'fault-world-full-sweep.json'),JSON.stringify(evaluateWorldSweep(read.records,read.admission,saved.rawJournal,read.authority,read.complete),null,2));expect(read.complete).toBe(true);expect(read.issues).toEqual([]);expect(report.outcome).toMatchObject({status:'needs_attention',served:'0'});expect(report.businessEvents.filter(e=>e.type==='CupHandedOff')).toEqual([]);
 const disturbed=read.records.filter(r=>r.snapshot.worldStep?.disturbances?.length);expect(disturbed).toHaveLength(1);const at=disturbed[0]!,receipt=at.snapshot.worldStep!.disturbances![0]!;expect(at.command!.worldPerturbations).toHaveLength(1);expect(receipt).toMatchObject({presetId,revision:1,frame:'map',durationSubsteps:10,runId:report.manifest.runId,bootId:at.snapshot.bootId,sceneDigest:at.snapshot.sceneDigest});
 expect(at.command!.propPlacements).toEqual([]);expect(at.snapshot.props!.some(p=>p.propId==='cup-1')).toBe(true);
 const last=read.records.at(-1)!.snapshot,cup=report.coffee!.cups.find(c=>c.cupId==='cup-1')!;
 const origin=read.scene.navigation.robots[0]!.initialPoseMap,dockInvalid=(s:typeof last)=>{const r=s.robots[0]!,yaw=Math.atan2(Math.sin(r.poseDriveMap[2]!-origin[2]!),Math.cos(r.poseDriveMap[2]!-origin[2]!));return Math.hypot(r.poseDriveMap[0]!-origin[0]!,r.poseDriveMap[1]!-origin[1]!)>.01||Math.abs(yaw)>.02||Math.abs(r.bodyVelocity[0]!)>.01||Math.abs(r.bodyVelocity[1]!)>.02;};
 const stopTick=report.coffee!.armTrace.stop?.events.find(e=>e.stage==='requested')?.tick;let observedViolationTick:number|undefined;
 if(presetId==='world-dock-drift-v1'){
  observedViolationTick=read.records.find(r=>r.snapshot.tick>=at.snapshot.tick&&dockInvalid(r.snapshot))?.snapshot.tick;expect(observedViolationTick).toBe(at.snapshot.tick);expect(stopTick).toBe(observedViolationTick);
  expect(report.attention.map(a=>a.reason)).toContain('DOCK_OUT_OF_TOLERANCE');expect(report.coffee!.armTrace.stop?.reason).toBe('DOCK_OUT_OF_TOLERANCE');expect(cup.ownerKind).toBe('arm');
  expect(read.records[at.snapshot.tick-1]!.snapshot.arms![0]!.gripper!.heldPropIds).toContain('cup-1');expect(at.snapshot.arms![0]!.gripper!.heldPropIds).toContain('cup-1');expect(last.arms![0]!.gripper!.heldPropIds).toContain('cup-1');
  for(const r of read.records.slice(at.snapshot.tick))expect(r.command!.gripperTargets![0]!.openingM).toBe(0);
 }else{
  const below=(n:number)=>{const z=read.records[n]?.snapshot.physics!.loads.find(l=>l.propId==='cup-1')?.poseInSupport?.positionM[2];return typeof z==='number'&&z<-.05;};observedViolationTick=read.records.find((r,n)=>r.snapshot.tick>=at.snapshot.tick+2&&below(n)&&below(n-1)&&below(n-2))?.snapshot.tick;expect(observedViolationTick).toBeDefined();expect(stopTick).toBe(observedViolationTick);
  expect(report.attention.map(a=>a.reason)).toContain('LOAD_FELL');expect(cup.ownerKind).toBe('robot');expect(report.coffee!.physicalCustody?.find(c=>c.cupId==='cup-1')).toMatchObject({parent:null,status:'lost'});
  expect(read.records[at.snapshot.tick-1]!.snapshot.props!.find(p=>p.propId==='cup-1')?.restingOn).toBe('amr-1/tray-1');expect(last.physics!.loads.find(p=>p.propId==='cup-1')!.poseInSupport!.positionM[2]).toBeLessThan(-.05);
  expect(last.props!.some(p=>p.propId==='cup-1')).toBe(true);
 }
 await writeFile(join(h.directory,'fault-timeline.json'),JSON.stringify({accepted:false,calibration:'not_calibrated',presetId,disturbanceTick:at.snapshot.tick,observedViolationTick,sourceStopDecisionTick:stopTick,nextPhysicalCommandTick:read.records.find(r=>r.snapshot.tick>stopTick!)?.command?.targetTick??null,terminalPublicTick:report.outcome.tick,recordedResponseTicks:stopTick!-observedViolationTick!,note:'Modeled Source latch after actual native observation; no earlier physical stopping or hardware ACK is claimed.',disturbanceReceipt:receipt,actualAtDisturbance:{robot:at.snapshot.robots[0],arm:at.snapshot.arms![0],cup:at.snapshot.props!.find(p=>p.propId==='cup-1')}} ,null,2));
},3500000);

test('cancel while actually holding keeps the gripper command and cup, with no served confirmation',async()=>{
 const h=await openCell(7,'cancel-held');try{await h.run.start();const v=await cellUntil(h.run,held,5000,25);expect(held(v)).toBe(true);const before=h.bindings().snapshot();expect(before.arms![0]!.gripper!.heldPropIds).toContain('cup-1');
  await act(h.run,'cancel');const {report}=await h.save('cancel');expect(report.outcome.served).toBe('0');expect(report.coffee!.cups.find(c=>c.cupId==='cup-1')!.ownerKind).toBe('arm');expect(h.input().state.arm.gripperCommandM).toBe(0);expect(h.input().state.arm.holding).toBe('cup-1');expect(h.input().state.arm.stop?.reason).toBe('CELL_CANCELLED');expect(h.bindings().snapshot()).toEqual(before);expect(report.businessEvents.filter(e=>e.type==='CupHandedOff')).toEqual([]);
 }finally{await h.run.close();expect(h.processes.processes()).toEqual([]);}
},3500000);

for(const fault of ['worker-loss','lost-ack'] as const)test(`actual ${fault} latches unknown and reopens without another world or cup`,async()=>{
 let drop=false,steps=0;let directory='';const original=workerClient.spawnMujocoWorker;
 if(fault==='lost-ack')vi.spyOn(workerClient,'spawnMujocoWorker').mockImplementation(async options=>{const worker=await original(options);return {...worker,async request(request){if(request.op==='step')steps++;const result=await worker.request(request);if(drop&&request.op==='step'){drop=false;await writeFile(join(directory,'lost-ack-native-response.json'),JSON.stringify({request,response:result},null,2));throw new WorkerLostError('ACK_TIMEOUT','unknown','registered test loss after actual native effect');}return result;}};});
 const h=await openCell(7,fault);directory=h.directory;let saved!:Awaited<ReturnType<typeof h.save>>,tick=0,count=0;
 try{await h.run.start();const v=await cellUntil(h.run,held,5000,25);expect(held(v)).toBe(true);tick=v.tick;
  if(fault==='worker-loss'){const killed=h.processes.kill(h.directory,/ -m mujoco_worker(?: |$)/);expect(killed).toHaveLength(1);await new Promise(r=>setTimeout(r,100));}else drop=true;
  await expect(act(h.run,'step',{ticks:1})).rejects.toThrow();const current=await h.run.snapshot();expect(current.tick).toBe(tick);expect(current.entities[0]!.quality).toBe('stale');const sent=steps;await expect(act(h.run,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');expect(steps).toBe(sent);
  saved=await h.save(fault);count=saved.report.businessEvents.filter(e=>e.type==='CupBound').length;expect(saved.report.outcome.served).toBe('0');expect(saved.report.coffee!.cups.find(c=>c.cupId==='cup-1')!.ownerKind).toBe('arm');expect(saved.report.coffee!.physicalCustody?.find(c=>c.cupId==='cup-1')).toMatchObject({parent:null,status:'unknown'});expect(h.input().state.arm.gripperCommandM).toBe(0);
  const cp=JSON.parse(await readFile(join(h.directory,'run.json'),'utf8'));expect(cp.world.pending).toMatchObject({targetTick:tick+1,stage:'sent',ackTick:null});
 }finally{await h.run.close();expect(h.processes.processes()).toEqual([]);}
 const read=await h.readback();expect(read.complete).toBe(false);expect(read.records.at(-1)!.snapshot.tick).toBe(tick);
 if(fault==='lost-ack'){const raw=JSON.parse(await readFile(join(directory,'lost-ack-native-response.json'),'utf8'));expect(raw.response.tick).toBe(tick+1);expect(raw.response.result.arms[0].gripper.heldPropIds).toContain('cup-1');}
 const reopened=await h.reopen();try{expect(h.opens()).toBe(1);expect((await reopened.snapshot()).tick).toBe(tick);await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');expect((await reopened.journal()).flatMap(e=>e.events).filter(e=>e.type==='CupBound')).toHaveLength(count);}finally{await reopened.close();expect(h.processes.processes()).toEqual([]);}
},3500000);
});
