vi.mock('../../src/i18n',()=>({tr:(vi:string)=>vi}));
import {expect,test,vi} from 'vitest';
import {editSchedule,validateSchedule,type FaultScheduleEntry} from '../../src/scenarios/fault-schedule';
import {validateProjectV2} from '../../src/project/schema';
import fixture from '../../fixtures/twins/coffee-cell-v2.json';
const e:FaultScheduleEntry={id:'f1',faultId:'cup-removed',targetId:'coffee-1',trigger:{kind:'phase',value:'grasp'},durationMs:1000};
test('schedule export roundtrip preserves bounded typed entries without mutating locked project',()=>{
 const p=validateProjectV2(fixture.project),target=p.entities.find(t=>t.kind==='coffee_machine')!.id,updated=editSchedule(p,[{...e,targetId:target}]);
 expect(p.faultSchedule).toBeUndefined();expect(validateProjectV2(JSON.parse(JSON.stringify(updated))).faultSchedule).toEqual([{...e,targetId:target}]);
 for(const entries of [[e,e],[{...e,durationMs:Infinity}],[{...e,durationMs:60001}],[{...e,trigger:{kind:'phase',value:'shell'}}],[{...e,command:'rm'}]])expect(()=>validateSchedule(entries)).toThrow();
 expect(()=>editSchedule(p,[{...e,targetId:'arm-1'}])).toThrow('FAULT_TARGET_UNSUPPORTED');
});
test('replay exposes fired and window-ended markers only at or before the cursor',async()=>{
 const {coffeeReplay}=await import('../support/coffee-replay');const {openReplayV2}=await import('../../src/reports/replay');const {replayBody}=await import('../../src/ui/report-panel');const r=coffeeReplay().report;
 r.faults=[{tick:10,faultId:'schedule:f1:fired',entityId:'coffee-1'},{tick:20,faultId:'schedule:f1:window-ended',entityId:null}];
 const rp=openReplayV2(r),render=(tick:number)=>replayBody({rp,tick,playing:false},null);
 expect(render(5)).not.toContain('schedule:f1');expect(render(10)).toContain('schedule:f1:fired');expect(render(10)).not.toContain('window-ended');expect(render(20)).toContain('window-ended');
});
test('native schedule editor exposes supported phase-target faults without changing geometry',async()=>{
 const {faultScheduleEditor}=await import('../../src/ui/fault-schedule'),native=await import('../../fixtures/twins/native-bv01-v2.json');const p=validateProjectV2(native.default.project),entry:FaultScheduleEntry={id:'cut',faultId:'tunnel-loss',targetId:'arm-1',trigger:{kind:'phase',value:'handoff'},durationMs:100};
 const edited=editSchedule(p,[entry],'simulation');expect(edited.entities).toEqual(p.entities);expect(edited.world).toEqual(p.world);expect(edited.faultSchedule).toEqual([entry]);expect(()=>editSchedule(p,[{...entry,targetId:'amr-1'}],'simulation')).toThrow();
 const html=faultScheduleEditor(p,{faultId:'tunnel-loss',targetId:'arm-1',trigger:'phase',value:'handoff',durationMs:'100'},false,'simulation');expect(html).toContain('tunnel-loss');expect(html).toContain('controller-restart');expect(html).not.toContain('arm-following-error');expect(html).not.toContain('disabled');
});
