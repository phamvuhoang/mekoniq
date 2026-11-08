// Worker loss and source restarts on IR-FD01: an unverifiable step leaves the command unknown, the motion is never resent, and a reopened run only
// reads its journal and checkpoint (cargo, reservations and custody stay where the source put them). Skipped where the IR-SIM venv is missing.
import {afterEach,beforeAll,expect,test} from 'vitest';
import {rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {act,double,irsimAvailable,irsimBundle,openRun,stepUntil,temp,workerLog} from '../support/irsim-mission';

let bundle:Awaited<ReturnType<typeof irsimBundle>>;
const runs:ScenarioRun[]=[],dirs:string[]=[];
beforeAll(async()=>{if(irsimAvailable)bundle=await irsimBundle();},120_000);
afterEach(async()=>{for(const r of runs.splice(0))await r.close().catch(()=>{});for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function open(dir?:string,over:Parameters<typeof openRun>[2]={entry:[double('logged.py')]}){if(!dir){dir=await temp('irsim-recovery-');dirs.push(dir);}const run=await openRun(dir,bundle,over);runs.push(run);return {run,dir};}
const movingWith=(dir:string,speed:number)=>()=>{const last=workerLog(dir).filter(l=>l.op==='step').at(-1);return !!last&&Math.abs(last.robots[0]!.bodyVelocity[0]!)>speed;};
const commandStates=async(run:ScenarioRun,commandId:string)=>(await run.report()).businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.id===commandId).map(e=>String(e.state.status));

test.skipIf(!irsimAvailable)('GATE (c) IR-FD01: a lost step ACK keeps the command unknown and the motion command is never resent',async()=>{
 const {run,dir}=await open();
 await run.start();
 const moving=await stepUntil(run,movingWith(dir,0.2),10),commandId=moving.entities[0]!.goal!.commandId;
 const before=workerLog(dir);
 await writeFile(join(dir,'worker','crash-next-step'),''); // the double applies the next step and dies before acknowledging it
 const v=await act(run,'step',{ticks:5});
 // the source clock is committed only after a valid ACK: the applied-but-unacknowledged step never became source time
 expect(v.tick).toBe(moving.tick);
 expect(v.run.status).toBe('needs_attention');
 expect(v.attention.map(a=>a.reason)).toEqual(expect.arrayContaining(['WORKER_LOST','EXECUTION_UNKNOWN']));
 const log=workerLog(dir),sent=log.slice(before.length);
 expect(sent.map(l=>[l.op,l.payload.targetTick])).toEqual([['step',moving.tick+1]]); // one step on the wire, then nothing
 expect(log.filter(l=>l.op==='create')).toHaveLength(1);
 expect(await commandStates(run,commandId)).toEqual(['accepted','unknown']);
 const r=await run.report();
 expect(r.effects.filter(e=>e.type==='robot.execute'&&String(e.payload.commandId)===commandId)).toMatchObject([{status:'confirmed',attempts:1}]);
 expect(r.outcome.served).toBe('0');
 // nothing drives the plant any more: no step, no new process; reconcile only reports what is known
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');
 const rec=await act(run,'reconcile',{subjectId:'amr-1'});
 expect(rec.run.status).toBe('needs_attention');
 expect((await run.report()).reconciliations).toMatchObject([{subjectId:'amr-1',commandId,nativeState:'unknown'}]);
 await run.close();runs.splice(runs.indexOf(run),1);
 const reopened=(await open(dir)).run;
 expect((await reopened.snapshot()).run.status).toBe('needs_attention');
 await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');
 expect(workerLog(dir)).toHaveLength(log.length); // the reopened run never spawned a worker, so nothing was replayed
 expect(await commandStates(reopened,commandId)).toEqual(['accepted','unknown']);
},240_000);

test.skipIf(!irsimAvailable)('source restart with cargo on board: the reopened run reports the leg unknown and keeps cargo, reservation and custody; no worker is started',async()=>{
 const {run,dir}=await open();
 await run.start();
 // after the scripted load the robot drives the food to the table
 await stepUntil(run,async v=>(await run.report()).businessEvents.some(e=>e.type==='CargoLoaded')&&v.entities[0]!.moving);
 const moving=await stepUntil(run,movingWith(dir,0.2),10),commandId=moving.entities[0]!.goal!.commandId;
 await run.close();runs.splice(runs.indexOf(run),1); // the process ends with the leg in flight; the worker goes with it
 const before=workerLog(dir).length;
 const reopened=(await open(dir)).run,view=await reopened.snapshot();
 expect(view.run.status).toBe('needs_attention');
 expect(view.attention.map(a=>a.reason)).toEqual(expect.arrayContaining(['RECOVERY_UNKNOWN']));
 expect(view.served).toBe('0');
 const r=await reopened.report(),last=(kind:string,id?:string)=>r.businessEvents.filter(e=>e.kind===kind&&(!id||e.id===id)).at(-1)!.state;
 expect(r.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.id===commandId).map(e=>e.state.status)).toEqual(['accepted','unknown']);
 expect(last('mission')).toMatchObject({loaded:true,status:'needs_attention'});
 expect(last('robot')).toMatchObject({availability:'unknown'});
 expect(r.businessEvents.filter(e=>e.kind==='reservation').at(-1)!.state).toMatchObject({status:'granted',robotId:'amr-1'});
 expect(r.businessEvents.some(e=>e.type==='DeliveryHandedOff')).toBe(false);
 await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');
 expect(workerLog(dir)).toHaveLength(before);
 // a rerun is a new run id with the same locked inputs, never a continuation of this one
 const rerun=(await open()).run;
 expect(rerun.id).not.toBe(reopened.id);
 expect((await rerun.report()).manifest.scenario).toEqual(r.manifest.scenario);
},240_000);

test.skipIf(!irsimAvailable)('cancel ACK loss: a cancel whose stopping step is never acknowledged leaves the command unknown, not cancelled',async()=>{
 const {run,dir}=await open();
 await run.start();
 const moving=await stepUntil(run,movingWith(dir,0.2),10),commandId=moving.entities[0]!.goal!.commandId;
 await act(run,'cancel');
 await act(run,'step',{ticks:3}); // still decelerating
 await writeFile(join(dir,'worker','crash-next-step'),'');
 const v=await act(run,'step',{ticks:5});
 expect(v.run.status).toBe('needs_attention');
 expect(await commandStates(run,commandId)).not.toContain('cancelled');
 const r=await run.report();
 // the source keeps the mission cancelling: it refuses an unknown outcome during cancellation and waits for reconciliation, it never assumes the stop
 expect(r.businessEvents.filter(e=>e.kind==='mission').at(-1)!.state.status).toBe('cancelling');
 expect(r.rejectedObservations).toEqual(expect.arrayContaining([expect.objectContaining({commandId,type:'unknown',code:'CANCELLATION_RECONCILIATION_REQUIRED'})]));
 expect(v.attention.map(a=>a.reason)).toContain('WORKER_LOST');
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('PLANT_LOST');
 await act(run,'reconcile',{subjectId:'amr-1'});
 expect((await run.report()).reconciliations).toMatchObject([{subjectId:'amr-1',commandId,nativeState:'unknown'}]);
},240_000);

/** Fails the source commit of the first `completed` observation once, as a busy or full store would. */
function failCompletedOnce(run:ScenarioRun){
 const source=(run as unknown as {source:{submit:(...a:unknown[])=>Promise<unknown>}}).source,real=source.submit.bind(source);let failed=false;
 source.submit=async(...a:unknown[])=>{const payload=a[1] as {type?:string};if(!failed&&a[0]==='Robot.Observe'&&payload.type==='completed'){failed=true;throw new Error('SQLITE_BUSY');}return real(...a);};
 return ()=>failed;
}
async function stepToDroppedCompletion(run:ScenarioRun){
 const failed=failCompletedOnce(run);
 for(let i=0;i<4000&&!failed();i++){try{await act(run,'step',{ticks:5});}catch(e){if(!failed())throw e;}}
 expect(failed()).toBe(true);
}

test.skipIf(!irsimAvailable)('review B04 #1: a completed observation that the source could not commit is not lost: it is retried, and the leg is never left silently travelling',async()=>{
 const {run}=await open(undefined,{});
 await run.start();
 await stepToDroppedCompletion(run);
 // the dropped observation goes back on the queue: the next tick commits it and the source sees the arrival
 for(let i=0;i<20;i++)await act(run,'step',{ticks:5}); // the interrupted action left its own attention; stepping stays allowed
 expect((await run.report()).businessEvents.filter(e=>e.type==='MissionArrived').length).toBeGreaterThanOrEqual(1);
},240_000);

test.skipIf(!irsimAvailable)('review B04 #1: after a restart, a leg whose completion never reached the journal is unknown and reconcile does not report completed',async()=>{
 const {run,dir}=await open(undefined,{});
 await run.start();
 await stepToDroppedCompletion(run);
 await run.close();runs.splice(runs.indexOf(run),1);
 const reopened=(await open(dir,{})).run,r=await reopened.report();
 const commandId=r.businessEvents.filter(e=>e.type==='RobotCommandObserved').at(-1)!.id;
 expect(r.businessEvents.filter(e=>e.type==='RobotCommandObserved'&&e.id===commandId).map(e=>e.state.status)).toEqual(['accepted','unknown']);
 await act(reopened,'reconcile',{subjectId:'amr-1'});
 expect((await reopened.report()).reconciliations).toMatchObject([{subjectId:'amr-1',commandId,nativeState:'unknown'}]);
},240_000);

test.skipIf(!irsimAvailable)('review B04 #2: closing and reopening a finished run keeps it completed (nothing was in flight, so nothing is unknown)',async()=>{
 const {run,dir}=await open(undefined,{});
 await run.start();
 await stepUntil(run,v=>v.run.status==='completed',50);
 const before=await run.snapshot();
 await run.close();runs.splice(runs.indexOf(run),1);
 const after=await (await open(dir,{})).run.snapshot();
 expect([after.run.status,after.served,after.attention]).toEqual(['completed',before.served,[]]);
},240_000);

test.skipIf(!irsimAvailable)('review B04-2 #4: a cancelled, stopped run reopens cancelled; a cancel still stopping reopens unknown',async()=>{
 const {run,dir}=await open();
 await run.start();
 await stepUntil(run,movingWith(dir,0.2),10);
 await act(run,'cancel');
 let v=await run.snapshot();
 for(let i=0;i<300&&v.run.status!=='cancelled';i++)v=await act(run,'step',{ticks:1});
 expect(v.run.status).toBe('cancelled');
 await run.close();runs.splice(runs.indexOf(run),1);
 const after=await (await open(dir)).run.snapshot();
 expect([after.run.status,after.attention]).toEqual(['cancelled',[]]);
 // the other direction: the cancel was requested but the stop was never observed before the process ended
 const b=await open();
 await b.run.start();
 await stepUntil(b.run,movingWith(b.dir,0.2),10);
 await act(b.run,'cancel');await act(b.run,'step',{ticks:1});
 expect((await b.run.snapshot()).run.status).toBe('running');
 await b.run.close();runs.splice(runs.indexOf(b.run),1);
 const again=await (await open(b.dir)).run.snapshot();
 expect(again.run.status).toBe('needs_attention');expect(again.attention.map(a=>a.reason)).toContain('RECOVERY_UNKNOWN');
},240_000);
