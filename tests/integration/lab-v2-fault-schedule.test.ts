import {afterEach,expect,test} from 'vitest';
import {dueFaults,validateFaultSchedule,type FaultScheduleEntry} from '../../packages/lab-runtime/src/v2/fault-schedule';
import {act,cleanupRuns,coffeeProject,openCoffee,runDirectory} from '../support/lab-v2';
const entry:FaultScheduleEntry={id:'f1',faultId:'cup-removed',targetId:'coffee-1',trigger:{kind:'phase',value:'grasp'},durationMs:1000};
afterEach(cleanupRuns);
test('bounded schedules reject unsupported targets/backends and fire overdue entries once',()=>{
 expect(dueFaults([entry],new Set(),10,'grasp')).toEqual([entry]);expect(dueFaults([entry],new Set(['f1']),10,'grasp')).toEqual([]);
 expect(dueFaults([{...entry,trigger:{kind:'elapsed_sim_ms',value:10}}],new Set(),10000,'brew')).toHaveLength(1);
 const p=coffeeProject();expect(()=>validateFaultSchedule([entry],p.entities,'mock')).not.toThrow();
 for(const entries of [[entry,entry],[{...entry,durationMs:0}],[{...entry,targetId:'arm-1'}],[{...entry,trigger:{kind:'elapsed_sim_ms',value:NaN}}]])expect(()=>validateFaultSchedule(entries,p.entities,'mock')).toThrow();
 expect(validateFaultSchedule([entry],p.entities,'simulation')).toEqual([entry]);expect(()=>validateFaultSchedule([{...entry,faultId:'machine-not-ready'}],p.entities,'simulation')).toThrow('FAULT_BACKEND_UNSUPPORTED');expect(()=>validateFaultSchedule([entry],p.entities,'hardware')).toThrow('FAULT_BACKEND_UNSUPPORTED');
});
test('fired markers and frozen schedule survive reopening without a second injection',async()=>{
 const directory=await runDirectory(),project={...coffeeProject(),faultSchedule:[{...entry,faultId:'machine-not-ready',trigger:{kind:'elapsed_sim_ms' as const,value:20}}]};
 let run=await openCoffee('BV01',{seed:42,directory,project});await run.start();await act(run,'step',{ticks:3});const before=await run.report();expect(before.faults.filter(f=>f.faultId==='machine-not-ready')).toHaveLength(1);expect(before.manifest.faultSchedule?.hash).toMatch(/^[a-f0-9]{64}$/);await run.close();
 run=await openCoffee('BV01',{seed:42,directory,project});await act(run,'step',{ticks:3});expect((await run.report()).faults.filter(f=>f.faultId==='machine-not-ready')).toHaveLength(1);await run.close();
 await expect(openCoffee('BV01',{seed:42,directory,project:{...project,faultSchedule:[{...project.faultSchedule[0]!,durationMs:2}]}})).rejects.toThrow('RUN_IDENTITY_MISMATCH');
});
test('interrupted persisted injection remains unknown and is never dispatched on reopen',async()=>{
 const {readCheckpoint,writeCheckpoint}=await import('../../packages/lab-runtime/src/v2/checkpoint');const directory=await runDirectory(),project={...coffeeProject(),faultSchedule:[{...entry,trigger:{kind:'elapsed_sim_ms' as const,value:0}}]};
 let run=await openCoffee('BV01',{seed:42,directory,project});await run.start();await run.close();
 const cp=await readCheckpoint<Record<string,unknown>>(directory);await writeCheckpoint(directory,{...cp,faultFires:[{id:'f1',tick:0,expiresAtMs:1000,outcome:'dispatching'}]});
 run=await openCoffee('BV01',{seed:42,directory,project});expect((await run.snapshot()).attention).toEqual(expect.arrayContaining([expect.objectContaining({reason:'FAULT_INJECTION_UNKNOWN',subjectId:'f1'})]));await act(run,'step',{ticks:2});expect((await run.report()).faults.some(f=>f.faultId==='cup-removed')).toBe(false);await run.close();
});
test('phase trigger holds once across restart and window expiry never repairs a missing cup',async()=>{
 const directory=await runDirectory(),project={...coffeeProject(),faultSchedule:[entry]};let run=await openCoffee('BV01',{seed:42,directory,project});await run.start();
 for(let i=0;i<30&&!((await run.report()).faults.some(f=>f.faultId==='cup-removed'));i++)await act(run,'step',{ticks:250});
 expect((await run.report()).faults.filter(f=>f.faultId==='cup-removed')).toHaveLength(1);await run.close();run=await openCoffee('BV01',{seed:42,directory,project});await act(run,'step',{ticks:250});const r=await run.report();expect(r.faults.filter(f=>f.faultId==='cup-removed')).toHaveLength(1);expect(r.outcome.served).toBe('0');expect(r.faultScheduleFires?.[0]?.windowEnded).toBe(true);await run.close();
});
test('fault target must be instantiated by this scenario, not merely present in the project',async()=>{
 const p=coffeeProject(),extra={...p.entities.find(e=>e.kind==='coffee_machine')!,id:'coffee-2'},project={...p,entities:[...p.entities,extra]};
 await expect(openCoffee('BV01',{seed:42,project:{...project,faultSchedule:[{...entry,targetId:'coffee-2'}]}})).rejects.toThrow('FAULT_TARGET_INVALID');
 const run=await openCoffee('BV01',{seed:42,project});try{await run.start();await expect(act(run,'injectFault',{faultId:'cup-removed',entityId:'coffee-2'})).rejects.toThrow('INVALID_FAULT');expect((await run.report()).faults).toEqual([]);}finally{await run.close();}
 const {openFixture}=await import('../support/lab-v2');await expect(openFixture('FD01',{seed:42,project:{...project,world:{...project.world,points:project.world.points.map(p=>p.kind==='coffee_pickup'?{...p,kind:'kitchen'}:p)},faultSchedule:[entry]}})).rejects.toThrow('FAULT_TARGET_INVALID');
});
