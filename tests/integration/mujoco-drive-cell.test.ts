// V04, cell: MJ-CELL-BV01 through the two controllers and a virtual drive on nine axes, on the real engine.
import {afterEach,expect,test} from 'vitest';
import {readFile,rm,writeFile} from 'node:fs/promises';
import {openCell,cellUntil,cellCampaign} from '../support/mujoco-cell';
import {spawnMujocoWorker} from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';

type Cell=Awaited<ReturnType<typeof openCell>>;
const open:Cell[]=[];
afterEach(async()=>{for(const h of open.splice(0)){await h.run.close().catch(()=>{});await rm(h.directory,{recursive:true,force:true});}});
let ordinal=0;
async function act(h:Cell,kind:string,payload={}){const v=await h.run.snapshot();return h.run.action({actionId:`cell-drive-${++ordinal}`,expectedRevision:v.run.runRevision,kind,payload});}
const deadline=cellCampaign.nativeDeadlineSecondsPerCase*1000;

test('MJ-CELL-BV01 on drive-nominal-v1, seed 7, serves two coffees through the controllers and the drive',async()=>{
 const h=await openCell(7,'drive-nominal',{},{driveExperimentId:'drive-nominal-v1'});open.push(h);
 await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
 const saved=await h.save('drive-nominal'),report=saved.report;
 expect(report.outcome,JSON.stringify(report.attention)).toMatchObject({status:'completed',served:'2'});expect(report.attention).toEqual([]);
 expect(report.manifest.drive).toMatchObject({testLevel:'controller_in_the_loop',experimentId:'drive-nominal-v1'});
 expect(['arm64','x86_64']).toContain(report.manifest.drive!.hostArch);   // the worker's own architecture, recorded for every drive run (contracts §1)
 expect(report.manifest.drive!.controllers).toEqual([{id:'joint-trajectory-follower-v1',revision:1},{id:'diff-drive-base-v1',revision:2},{id:'exhausted-route-correction',revision:1}]);
 // the saved report carries the drive section (once, at the root) built from the recorded stream: 9 axes, all enabled, no faults
 expect(report.driveEvidence).toMatchObject({testLevel:'controller_in_the_loop',complete:true,issues:[]});expect(report.driveEvidence!.axes).toHaveLength(9);expect(report.driveEvidence!.axes.every(a=>a.faults.length===0&&a.enabledAtTick!==null)).toBe(true);expect((report.coffee as {driveEvidence?:unknown}).driveEvidence).toBeUndefined();
 expect(saved.report.manifest.drive!.testLevel).toBe('controller_in_the_loop');
 await h.run.close();   // the world evidence is published on close
 const read=await h.readback();expect(read.issues).toEqual([]);expect(read.complete).toBe(true);
 const rows=read.records;expect(rows.length).toBe(report.outcome.tick+1);
 // every tick after the first carries nine drive commands and nine axis snapshots; no command ever asked for a faultReset; no axis ever faulted
 for(const r of rows.slice(1)){const cmds=r.command?.driveCommands;expect(cmds).toHaveLength(9);expect(cmds!.every(c=>!c.faultReset)).toBe(true);expect(r.snapshot.drives).toHaveLength(9);}
 expect(rows.flatMap(r=>(r.snapshot.drives??[]).map(d=>d.fault)).filter(Boolean)).toEqual([]);
 // the wire carried no velocities or arm targets, the evidence keeps the setpoints the controllers were given
 expect(rows.slice(1).every(r=>r.command?.velocities.length===1&&r.command?.jointTargets?.length===1)).toBe(true);
},deadline);

test('a cell run without driveExperimentId is the R2b run: no drive in the manifest, no driveCommands in any record',async()=>{
 const h=await openCell(7,'no-drive');open.push(h);
 await h.run.start();await cellUntil(h.run,v=>v.tick>=200,cellCampaign.maxTicks,50);
 const saved=await h.save('no-drive');await h.run.close();const read=await h.readback();
 expect(saved.report.manifest.drive).toBeUndefined();expect(read.records.every(r=>r.command?.driveCommands===undefined&&r.snapshot.drives===undefined)).toBe(true);
},deadline);

test('pausing a cell run for two wall seconds raises no drive fault (the cell runner takes no pacing: 64x is the AMR runner and the gateway)',async()=>{
 const h=await openCell(7,'drive-pause',{},{driveExperimentId:'drive-nominal-v1'});open.push(h);
 await h.run.start();await act(h,'step',{ticks:60});
 await act(h,'pause');await new Promise(r=>setTimeout(r,2000));await act(h,'resume');
 const v=await act(h,'step',{ticks:60});
 const snap=h.bindings().snapshot() as {drives:{fault:string|null;state:string}[]};
 expect(v.attention).toEqual([]);expect(snap.drives.map(d=>d.fault)).toEqual(Array(9).fill(null));expect(v.tick).toBe(120);
},120_000);

test('CIL05 (cell): a command stream that goes quiet for J2 while the hand holds the cup faults the drive; the hand keeps the cup and no command opens the gripper or resets',async()=>{
 // The plan's variant lowers the rated speed of J2 below the lift speed. The measured lift (J2 0.83 rad/s) is slower than the approach before the grasp (0.94 rad/s), so no rated speed separates
 // the two: the fault is made by what a lost command channel does (J2 repeats its last seq: COMMAND_TIMEOUT after 5 ticks), starting 20 ticks after the engine reports the cup held.
 let heldAt:number|null=null;const frozen:{seq?:number}={},afterFault:{cmd:Record<string,number>;pos:Record<string,number>}[]=[];let faulted=false;
 const spawn:typeof spawnMujocoWorker=async o=>{const w=await spawnMujocoWorker(o);return {...w,async request(req){
  if(req.op==='step'&&heldAt!==null&&(req.payload as {targetTick:number}).targetTick>=heldAt+20){
   const p=req.payload as {driveCommands?:{axisId:string;seq:number}[]};
   for(const c of p.driveCommands??[])if(c.axisId.endsWith('/J2')){frozen.seq??=c.seq;c.seq=frozen.seq;}
  }
  const r=await w.request(req);
  if(r.ok&&req.op==='step'){
   const drives=(r.result as {drives?:{axisId:string;fault:string|null;actualPositionRad:number}[]}).drives??[];
   if(faulted)afterFault.push({cmd:Object.fromEntries(((req.payload as {driveCommands?:{axisId:string;target:number}[]}).driveCommands??[]).filter(c=>!c.axisId.endsWith('/gripper')).map(c=>[c.axisId,c.target])),pos:Object.fromEntries(drives.filter(d=>d.axisId.startsWith('arm-1/')&&!d.axisId.endsWith('/gripper')).map(d=>[d.axisId,d.actualPositionRad]))});
   if(drives.some(d=>d.fault))faulted=true;
  }
  if(r.ok&&req.op==='step'&&heldAt===null&&(r.result as {arms?:{gripper:{heldPropIds:string[]}}[]}).arms?.[0]?.gripper.heldPropIds.length)heldAt=(r.result as {tick:number}).tick;
  return r;}};};
 const h=await openCell(7,'drive-cil05',{},{driveExperimentId:'drive-nominal-v1'},spawn);open.push(h);
 await h.run.start();
 await cellUntil(h.run,()=>heldAt!==null&&h.bindings().snapshot().tick>=heldAt+40,3000,5);
 // keep going: 100 ticks after the fault the cup is still between the pads
 const at=h.bindings().snapshot() as {tick:number;arms:{gripper:{heldPropIds:string[]}}[];drives:{axisId:string;state:string;fault:string|null}[]};
 await cellUntil(h.run,()=>h.bindings().snapshot().tick>=at.tick+100,3000,5);
 const end=h.bindings().snapshot() as typeof at,report=(await h.save('drive-cil05')).report;
 expect(end.drives.find(d=>d.axisId.endsWith('/J2'))).toMatchObject({state:'fault',fault:'COMMAND_TIMEOUT'});
 expect(end.arms[0]!.gripper.heldPropIds).toEqual(['cup-1']);                   // the engine still sees the cup between the pads
 // Source custody did not change: the cup is still the cell's, its pick transfer is unknown (never confirmed, never released), nothing moved it
 expect(report.coffee!.cups.find(c=>c.cupId==='cup-1')).toMatchObject({ownerKind:'cell',ownerId:'coffee-1',movements:[],disposition:null,pendingTransfer:{lastResult:'outcome_unknown'}});
 expect(report.attention.map(a=>a.reason)).toContain('TRANSFER_UNKNOWN');       // the run needs a person; it does not reset or retry
 expect(report.outcome.served).toBe('0');
 // the hold is latched at the fault (review of V05). A person who steps the stopped run for 5 s sees the joints that are still enabled keep the target of the fault: no command moves and the true
 // positions stay within 1.2 degrees of each other ("latest measurement" every tick let J3 sag 16 degrees); the cup stays between the pads
 await act(h,'step',{ticks:250});
 expect(afterFault.length).toBeGreaterThan(200);
 for(const id of Object.keys(afterFault[0]!.cmd))expect(new Set(afterFault.map(x=>x.cmd[id])).size,id).toBe(1);
 for(const id of Object.keys(afterFault[0]!.pos).filter(x=>!x.endsWith('/J2')))expect(Math.abs(afterFault.at(-1)!.pos[id]!-afterFault[2]!.pos[id]!),id).toBeLessThan(0.02);
 expect((h.bindings().snapshot() as typeof at).arms[0]!.gripper.heldPropIds).toEqual(['cup-1']);
 await h.run.close();
 const read=await h.readback(),after=read.records.filter(r=>r.snapshot.tick>(heldAt??0)+20);
 const gripper=after.map(r=>r.command!.driveCommands!.find(c=>c.axisId.endsWith('/gripper'))!.target);
 for(let k=1;k<gripper.length;k++)expect(gripper[k]!,`tick ${after[k]!.snapshot.tick}`).toBeGreaterThanOrEqual(gripper[k-1]!);   // never towards open (the open end of the range is 0)
 expect(read.records.every(r=>r.command?.driveCommands?.every(c=>!c.faultReset)??true)).toBe(true);
},deadline);

test('a live cell reports an unavailable retained bundle at its committed horizon',async()=>{
 const h=await openCell(7,'drive-hot-bundle',{},{driveExperimentId:'drive-nominal-v1'});open.push(h);
 await h.run.start();await act(h,'step',{ticks:3});
 expect((await h.run.report()).driveEvidence).toMatchObject({complete:true,ticks:4});
 const driveFile=h.directory+'/mujoco-world/bundle/world-drive-nominal-v1.json',original=await readFile(driveFile),damaged=Buffer.from(original);
 damaged[0]=32;await writeFile(driveFile,damaged);
 expect((await h.run.report()).driveEvidence).toMatchObject({complete:false,ticks:0,axes:[],events:[],issues:['WORLD_CLOSURE_INVALID']});
 await writeFile(driveFile,original);await rm(h.directory+'/mujoco-world/bundle/lab-world-scene.json');
 expect((await h.run.report()).driveEvidence).toMatchObject({complete:false,ticks:0,axes:[],events:[],issues:['WORLD_RETAINED_BUNDLE_UNAVAILABLE']});
},deadline);
