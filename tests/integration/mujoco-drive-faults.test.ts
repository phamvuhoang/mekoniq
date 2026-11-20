// V08, mobile: bounded drive, feedback and command-channel faults on MJ-FD01 with the nominal drive, on the real engine. Every expectation reads the evidence the run left, not the schedule.
import {expect,test} from 'vitest';
import {finish,setup} from '../support/mujoco-drive';
import type {FaultScheduleEntry} from '../../packages/lab-runtime/src/v2/fault-schedule';

const entry=(faultId:string,targetId:string,at:number,durationMs:number,params:Record<string,number>={}):FaultScheduleEntry=>({id:`${faultId}-${at}`,faultId,targetId,trigger:{kind:'elapsed_sim_ms',value:at},durationMs,params});
const R='amr-1/wheel-right';

test('an encoder dropout of 300 ms on the right wheel is detected by the drive in time; the run needs attention and serves nothing',async()=>{
 const e=entry('encoder-dropout',R,2000,300),{run,steps}=await setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});
 await run.start();const v=await finish(run);const report=await run.report();
 expect(v.attention.map(a=>a.reason),JSON.stringify(v.attention)).toContain('DRIVE_FAULT');expect(report.outcome.served).toBe('0');expect(report.outcome.status).not.toBe('completed');
 expect(report.manifest.driveFaultSchedule).toMatchObject({entries:[e]});
 // the wire carried the start and the end of the window, and the worker answered with receipts for them on those ticks only
 const sent=steps.filter(s=>(s.request.faultInjections as unknown[]|undefined)?.length);
 expect(sent.map(s=>(s.request.faultInjections as {phase:string}[])[0]!.phase)).toEqual(['start','end'].slice(0,sent.length));
 expect(steps.filter(s=>(s.result as {faultReceipts?:unknown[]}|null)?.faultReceipts).length).toBe(sent.length);
 const fr=report.faultReport!;expect(fr,JSON.stringify(report.driveEvidence?.issues)).toBeDefined();
 expect(fr.accepted).toBe(false);expect(fr.entries).toHaveLength(1);
 expect(fr.entries[0]).toMatchObject({faultId:'encoder-dropout',targetId:R,verdict:'detected_in_time',injection:{appliedTick:101},detection:{by:'drive',code:'FEEDBACK_LOSS'}});
 expect(fr.entries[0]!.detection.latencyTicks).toBeLessThanOrEqual(3);
 expect(fr.invariants.every(i=>i.result!=='violated'),JSON.stringify(fr.invariants)).toBe(true);
},300_000);

test('a command loss of 200 ms trips COMMAND_TIMEOUT within the oracle deadline, the wire repeats the last seq, and torque goes to zero',async()=>{
 const e=entry('command-loss',R,2000,200),{run,steps}=await setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});
 await run.start();await finish(run);const report=await run.report();
 const inside=steps.filter(s=>(s.request.targetTick as number)>=101&&(s.request.targetTick as number)<111);
 const seqOf=(s:typeof steps[number])=>(s.request.driveCommands as {axisId:string;seq:number}[]).find(c=>c.axisId===R)!.seq,other=(s:typeof steps[number])=>(s.request.driveCommands as {axisId:string;seq:number}[]).find(c=>c.axisId!==R)!.seq;
 expect(new Set(inside.map(seqOf)).size).toBe(1);expect(new Set(inside.map(other)).size).toBeGreaterThan(1);   // only the faulted axis went quiet
 const fr=report.faultReport!;expect(fr,JSON.stringify(report.driveEvidence?.issues)).toBeDefined();expect(fr.entries[0]).toMatchObject({verdict:'detected_in_time',detection:{by:'drive',code:'COMMAND_TIMEOUT'}});
 expect(fr.invariants.find(i=>i.id==='TORQUE_ZERO_AFTER_TIMEOUT')!.result).toBe('pass');
 expect(fr.invariants.find(i=>i.id==='LATCH_HELD')!.result).toBe('pass');
},300_000);

test('an entry that comes due after the run ended is not_fired, and nothing is claimed for it',async()=>{
 const e=entry('encoder-dropout',R,3_000_000,300),{run,steps}=await setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});
 await run.start();await finish(run);const report=await run.report();
 expect(report.outcome).toMatchObject({status:'completed',served:'1'});
 expect(report.faultReport!.entries[0]).toMatchObject({verdict:'not_fired',injection:{appliedTick:null}});
 expect(steps.some(s=>s.request.faultInjections!==undefined)).toBe(false);
},300_000);

test('schedules the server refuses never reach a run: overlap, a target that is not an axis, a run without a drive',async()=>{
 await expect(setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[entry('motor-weak',R,100,1000,{torqueScale:0.5}),entry('motor-weak',R,600,1000,{torqueScale:0.5})]})).rejects.toThrow('FAULT_OVERLAP');
 await expect(setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[entry('encoder-dropout','amr-1/ghost',100,300)]})).rejects.toThrow('FAULT_TARGET_INVALID');
 await expect(setup({driveFaultSchedule:[entry('encoder-dropout',R,100,300)]})).rejects.toThrow('FAULT_BACKEND_UNSUPPORTED');
 await expect(setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[entry('drive-reset',R,100,20)]})).rejects.toThrow('FAULT_CAMPAIGN_ONLY');
},300_000);

// ---- the shared-world cell: nine axes through one worker, MJ-CELL-BV01 ------------------------------------------------------------------------------------------------------
import {afterEach} from 'vitest';
import {rm} from 'node:fs/promises';
import {openCell,cellUntil,cellCampaign} from '../support/mujoco-cell';
type Cell=Awaited<ReturnType<typeof openCell>>;
const open:Cell[]=[];
afterEach(async()=>{for(const h of open.splice(0)){await h.run.close().catch(()=>{});await rm(h.directory,{recursive:true,force:true});}});
const deadline=cellCampaign.nativeDeadlineSecondsPerCase*1000;

test('cell: a command loss on the base wheel is detected by the drive; the arm and the cups are untouched; no false serve',async()=>{
 const e=entry('command-loss','amr-1/wheel-left',30_000,200),h=await openCell(7,'fault-loss',{},{driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});open.push(h);
 await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
 const {report}=await h.save('fault-loss');await h.run.close();
 const fr=report.faultReport!;expect(fr,JSON.stringify(report.driveEvidence?.issues)).toBeDefined();
 expect(fr.entries[0]).toMatchObject({faultId:'command-loss',targetId:'amr-1/wheel-left',injection:{appliedTick:1501},detection:{by:'drive',code:'COMMAND_TIMEOUT'}});
 expect(fr.entries[0]!.verdict).toBe('detected_in_time');
 expect(fr.invariants.filter(i=>i.result==='violated'),JSON.stringify(fr.invariants)).toEqual([]);
 const read=await h.readback();expect(read.issues).toEqual([]);
 // the command that was sent repeated its last seq on the wheel for the whole window and only on it
 const rows=read.records.filter(r=>r.snapshot.tick>=1501&&r.snapshot.tick<1511),seq=(r:typeof rows[number],a:string)=>r.command!.driveCommands!.find(c=>c.axisId===a)!.seq;
 expect(new Set(rows.map(r=>seq(r,'amr-1/wheel-left'))).size).toBe(1);expect(new Set(rows.map(r=>seq(r,'amr-1/wheel-right'))).size).toBeGreaterThan(1);
 expect(rows.every(r=>r.command!.faultInjections===undefined||r.command!.faultInjections.every(i=>i.faultId==='command-loss'))).toBe(true);
},deadline);

test('cell: a weak gripper never turns into a served cup nobody delivered, and custody is what the observations say',async()=>{
 const e=entry('grip-weak','arm-1/gripper',0,60_000,{torqueScale:0.1}),h=await openCell(7,'fault-grip',{},{driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});open.push(h);
 await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);
 const {report}=await h.save('fault-grip');await h.run.close();
 const fr=report.faultReport!;expect(fr,JSON.stringify(report.driveEvidence?.issues)).toBeDefined();
 expect(fr.entries[0]).toMatchObject({faultId:'grip-weak',injection:{appliedTick:1}});
 expect(fr.invariants.filter(i=>i.result==='violated'),JSON.stringify(fr.invariants)).toEqual([]);
 // whatever the plant did, the Source's served count is the journal's: it never exceeds the cups whose custody the observations followed to the customer
 const physical=(report.coffee as {physicalCustody?:{status:string;parent:string|null}[]}).physicalCustody??[];
 expect(Number(report.outcome.served)).toBeLessThanOrEqual(physical.filter(c=>c.status==='known'&&c.parent?.startsWith('table:')).length);
},deadline);

test('cell: schedules the world refuses never start a worker',async()=>{
 await expect(openCell(7,'fault-bad-1',{},{driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[entry('lidar-noise','amr-1/lidar-2d',100,1000,{sigmaM:0.01,dropoutFraction:0})]}).then(async h=>{open.push(h);await h.run.start();})).rejects.toThrow('FAULT_TARGET_INVALID');
 await expect(openCell(7,'fault-bad-2',{},{driveFaultSchedule:[entry('encoder-dropout','amr-1/wheel-left',100,300)]}).then(async h=>{open.push(h);await h.run.start();})).rejects.toThrow('FAULT_BACKEND_UNSUPPORTED');
},120_000);

test('cell: an arm axis fault that halts an idle arm ends the run in attention, not in a refused cup birth over the cup still at the nozzle',async()=>{
 const e=entry('encoder-dropout','arm-1/J2',25_000,300),h=await openCell(7,'fault-arm',{},{driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[e]});open.push(h);
 await h.run.start();await cellUntil(h.run,()=>false,cellCampaign.maxTicks,50);   // must not throw
 const {report}=await h.save('fault-arm');await h.run.close();
 expect(['needs_attention','completed']).toContain(report.outcome.status);expect(report.outcome.served).toBe('0');
 const fr=report.faultReport!;expect(fr,JSON.stringify(report.driveEvidence?.issues)).toBeDefined();
 expect(fr.entries[0]).toMatchObject({faultId:'encoder-dropout',verdict:'detected_in_time'});
 expect(fr.invariants.filter(i=>i.result==='violated')).toEqual([]);
},deadline);
