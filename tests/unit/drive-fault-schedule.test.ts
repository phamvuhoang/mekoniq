import {expect,test} from 'vitest';
import {defaultDraft,draftToEntry,faultCatalogOf,faultTargets,parseDriveScheduleFile,serialiseSchedule,driveFaultContext} from '../../src/scenarios/drive-faults';

const wire=[
 {id:'encoder-dropout',layer:'feedback',target:'axis',appliedBy:'worker',params:{durationMs:{min:20,max:5000,multipleOf:20,required:true}}},
 {id:'motor-weak',layer:'drive',target:'axis',appliedBy:'worker',params:{durationMs:{min:20,max:60000,multipleOf:20,required:true},torqueScale:{min:0.2,max:0.95,required:true}}},
 {id:'grip-weak',layer:'drive',target:'gripper',appliedBy:'worker',params:{durationMs:{min:20,max:60000,multipleOf:20,required:true},torqueScale:{min:0.1,max:0.9,required:true}}},
 {id:'lidar-noise',layer:'sensor',target:'lidar',appliedBy:'runtime',params:{durationMs:{min:20,max:60000,multipleOf:20,required:true},sigmaM:{min:0.005,max:0.1,required:true},dropoutFraction:{min:0,max:0.5,required:true}}}];
const cat=faultCatalogOf({faultCatalog:wire});

test('the catalog is what the runtime advertises; absent or malformed means no drive faults at all',()=>{
 expect(cat.map(f=>f.id)).toEqual(['encoder-dropout','motor-weak','grip-weak','lidar-noise']);
 for(const bad of [{},{faultCatalog:null},{faultCatalog:'x'},{faultCatalog:[{id:1}]},{faultCatalog:[{...wire[0],layer:'plant'}]},{faultCatalog:[{...wire[0],params:{durationMs:{min:5,max:1,required:true}}}]},null,undefined])
  expect(faultCatalogOf(bad),JSON.stringify(bad)).toEqual([]);
});
test('targets follow the kind of the fault: axes, the gripper axis, the LiDAR; nothing the preset does not have',()=>{
 const ctx=driveFaultContext('mujoco-cell')!;
 expect(faultTargets(cat[0]!,ctx)).toEqual(['arm-1/J1','arm-1/J2','arm-1/J3','arm-1/J4','arm-1/J5','arm-1/J6','amr-1/wheel-left','amr-1/wheel-right']);
 expect(faultTargets(cat[2]!,ctx)).toEqual(['arm-1/gripper']);expect(faultTargets(cat[3]!,ctx)).toEqual([]);
 const mobile=driveFaultContext('mujoco-payload')!;expect(faultTargets(cat[0]!,mobile)).toEqual(['amr-1/wheel-left','amr-1/wheel-right']);expect(faultTargets(cat[3]!,mobile)).toEqual(['amr-1/lidar-2d']);
 expect(driveFaultContext('coffee')).toBeNull();expect(driveFaultContext('delivery')).toBeNull();
});
test('a draft becomes an entry only inside the advertised bounds, with a typed refusal otherwise',()=>{
 const d=defaultDraft(cat,driveFaultContext('mujoco-payload')!);expect(d).toMatchObject({faultId:'encoder-dropout',targetId:'amr-1/wheel-left'});
 const ok=draftToEntry({faultId:'motor-weak',targetId:'amr-1/wheel-right',atMs:'8000',params:{durationMs:'5000',torqueScale:'0.5'}},cat);
 expect(ok).toMatchObject({ok:true,entry:{faultId:'motor-weak',targetId:'amr-1/wheel-right',trigger:{kind:'elapsed_sim_ms',value:8000},durationMs:5000,params:{torqueScale:0.5}}});
 if(ok.ok)expect(ok.entry.id).toMatch(/^[A-Za-z0-9_.:-]{1,200}$/);
 for(const [p,code] of [[{durationMs:'10'},'FAULT_PARAM_INVALID'],[{durationMs:'5000',torqueScale:'0.1'},'FAULT_PARAM_INVALID'],[{durationMs:'5000'},'FAULT_PARAM_INVALID'],[{durationMs:'5000',torqueScale:'x'},'FAULT_PARAM_INVALID'],[{durationMs:'5010',torqueScale:'0.5'},'FAULT_PARAM_INVALID']] as const)
  expect(draftToEntry({faultId:'motor-weak',targetId:'amr-1/wheel-right',atMs:'0',params:p},cat),JSON.stringify(p)).toEqual({ok:false,code});
 expect(draftToEntry({faultId:'motor-weak',targetId:'amr-1/wheel-right',atMs:'-1',params:{durationMs:'20',torqueScale:'0.5'}},cat)).toEqual({ok:false,code:'FAULT_TRIGGER_INVALID'});
 expect(draftToEntry({faultId:'nope',targetId:'x',atMs:'0',params:{}},cat)).toEqual({ok:false,code:'FAULT_UNKNOWN'});
});
test('the schedule file round-trips, and a file that is not a schedule is refused whole',()=>{
 const e1=draftToEntry({faultId:'encoder-dropout',targetId:'amr-1/wheel-right',atMs:'2000',params:{durationMs:'300'}},cat);if(!e1.ok)throw new Error('x');
 const text=serialiseSchedule([e1.entry]);expect(JSON.parse(text)).toMatchObject({schemaVersion:1,documentType:'drive-fault-schedule',entries:[{faultId:'encoder-dropout'}]});
 expect(parseDriveScheduleFile(text,cat)).toEqual({ok:true,entries:[e1.entry]});
 for(const bad of ['not json','{}','{"schemaVersion":1,"documentType":"lab-project"}',JSON.stringify({schemaVersion:1,documentType:'drive-fault-schedule',entries:[{...e1.entry,faultId:'no-such'}]}),
  JSON.stringify({schemaVersion:1,documentType:'drive-fault-schedule',entries:Array.from({length:17},(_,i)=>({...e1.entry,id:`x${i}`}))}),
  JSON.stringify({schemaVersion:1,documentType:'drive-fault-schedule',entries:[e1.entry,e1.entry]})])
  expect(parseDriveScheduleFile(bad,cat),bad.slice(0,60)).toMatchObject({ok:false});
});
