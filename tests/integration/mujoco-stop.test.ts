// R5 / E12: the emergency stop on the real engine, MJ-FD01 with the nominal drive. Every expectation reads what the worker answered and what the run kept, not the schedule.
import {expect,test} from 'vitest';
import {finish,setup} from '../support/mujoco-drive';
import type {FaultScheduleEntry} from '../../packages/lab-runtime/src/v2/fault-schedule';

const emergency=(at:number,id='s1')=>({id,function:'emergency' as const,trigger:{kind:'elapsed_sim_ms' as const,value:at}});
const BOTH=['amr-1/wheel-left','amr-1/wheel-right'];

test('an emergency stop trips both wheels on its tick, with a receipt that names the tick, and the run needs attention and serves nothing',async()=>{
 const {run,steps}=await setup({driveExperimentId:'drive-nominal-v1',stopSchedule:[emergency(2000)]});
 await run.start();const v=await finish(run);const report=await run.report();
 expect(v.attention.map(a=>a.reason),JSON.stringify(v.attention)).toContain('EMERGENCY_STOP');
 expect(report.outcome.served).toBe('0');expect(report.manifest.stopSchedule).toMatchObject({entries:[emergency(2000)]});
 const sent=steps.filter(s=>(s.request.stopInjections as unknown[]|undefined)?.length);
 expect(sent.map(s=>s.request.targetTick)).toEqual([101]);                                    // 2000 ms = tick 100, applied by the step that produces 101
 expect(sent[0]!.request.stopInjections).toEqual([{entryId:'s1',function:'emergency',axes:BOTH}]);
 const got=sent[0]!.result as {stopReceipts?:{appliedTick:number;appliedBy:string}[];drives:{state:string;fault:string|null}[]};
 expect(got.stopReceipts).toMatchObject([{entryId:'s1',function:'emergency',appliedBy:'worker',appliedTick:101}]);
 expect(got.drives.map(d=>[d.state,d.fault])).toEqual([['fault','EXTERNAL_TRIP'],['fault','EXTERNAL_TRIP']]);
 // no other step carried an injection or answered with a receipt
 expect(steps.filter(s=>(s.result as {stopReceipts?:unknown}|null)?.stopReceipts).length).toBe(1);
},300_000);

test('an emergency stop in the middle of a command loss still trips both wheels: it does not depend on the command channel',async()=>{
 const loss:FaultScheduleEntry={id:'cl',faultId:'command-loss',targetId:'amr-1/wheel-right',trigger:{kind:'elapsed_sim_ms',value:1960},durationMs:400,params:{}};
 const {run,steps}=await setup({driveExperimentId:'drive-nominal-v1',driveFaultSchedule:[loss],stopSchedule:[emergency(2000)]});
 await run.start();const v=await finish(run);
 expect(v.attention.map(a=>a.reason)).toContain('EMERGENCY_STOP');
 const at=steps.find(s=>s.request.targetTick===101)!,drives=(at.result as {drives:{axisId:string;state:string;fault:string|null}[]}).drives;
 expect(drives.map(d=>d.fault)).toEqual(['EXTERNAL_TRIP','EXTERNAL_TRIP']);                // the silenced wheel was tripped by the stop, not by its command timeout
},300_000);

test('a run without a stop schedule sends no stop field and keeps its evidence free of stop records',async()=>{
 const {run,steps}=await setup({driveExperimentId:'drive-nominal-v1'});
 await run.start();await finish(run);const report=await run.report();
 expect(steps.some(s=>s.request.stopInjections!==undefined||(s.result as {stopReceipts?:unknown}|null)?.stopReceipts!==undefined)).toBe(false);
 expect(report.manifest.stopSchedule).toBeUndefined();expect(report.outcome).toMatchObject({status:'completed',served:'1'});
},300_000);

test('schedules the server refuses never reach a run: too long, overlap, an unknown axis set, no drive',async()=>{
 await expect(setup({driveExperimentId:'drive-nominal-v1',stopSchedule:[1,2,3,4,5].map(i=>emergency(i*1000,'s'+i))})).rejects.toThrow('STOP_SCHEDULE_TOO_LONG');
 await expect(setup({driveExperimentId:'drive-nominal-v1',stopSchedule:[emergency(1990,'a'),emergency(2000,'b')]})).rejects.toThrow('STOP_OVERLAP');
 await expect(setup({driveExperimentId:'drive-nominal-v1',stopSchedule:[{id:'n',function:'normal',trigger:{kind:'elapsed_sim_ms',value:2000}}]})).rejects.toThrow('STOP_CONTROLLER_UNSUPPORTED');
 await expect(setup({stopSchedule:[emergency(2000)]})).rejects.toThrow(/STOP_BACKEND_UNSUPPORTED|STOP_CONTROLLER_UNSUPPORTED|Cannot read/);
},300_000);
