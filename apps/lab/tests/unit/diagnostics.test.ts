import {describe,expect,test} from 'vitest';
import {alarmMarks,alarmsOf,diagnosticsFor,selectableTargets,stopOf} from '../../src/reports/diagnostics';
import {diagnosticsPanel} from '../../src/ui/diagnostics-panel';
import {stopRow,stopRows} from '../../src/reports/stop';
import type {RunReport} from '../../src/scenarios/controls';
import type {StopReportV1} from '../../src/shared/navigation2d';

const drive=(extra:object={})=>({testLevel:'controller_in_the_loop',complete:true,issues:[],ticks:500,events:[],axes:[
 {axisId:'amr-1/wheel-left',mode:'csv',states:[{state:'disabled',fromTick:0},{state:'operation_enabled',fromTick:20},{state:'fault',fromTick:412}],faults:[{fault:'EXTERNAL_TRIP',firstTick:412}],enabledAtTick:20,saturatedSubsteps:3,trackingRms:{available:true,value:0.012,unit:'rad/s',samples:400,basis:'actual'},...extra},
 {axisId:'amr-1/wheel-right',mode:'csv',states:[{state:'operation_enabled',fromTick:20}],faults:[],enabledAtTick:20,saturatedSubsteps:0,trackingRms:{available:false,value:null,unit:'rad/s',reason:'TOO_FEW_SAMPLES'}}]});
const report=(o:object={})=>({driveEvidence:drive(),attention:[{tick:412,reason:'EMERGENCY_STOP',subjectId:'amr-1'}],...o}) as unknown as RunReport;

describe('targets and alarms',()=>{
 test('two wheels per robot then J1..J6 and the gripper, in a fixed order',()=>{
  const t=selectableTargets({robotIds:['amr-1'],armIds:['arm-1']});
  expect(t.map(x=>x.id)).toEqual(['amr-1/wheel-left','amr-1/wheel-right',...[1,2,3,4,5,6].map(j=>`arm-1/J${j}`),'arm-1/gripper']);
  expect(selectableTargets({robotIds:['a','b']}).map(x=>x.kind)).toEqual(['wheel','wheel','wheel','wheel']);
 });
 test('alarms merge drive faults and the stop, ordered by tick then id',()=>{
  const a=alarmsOf(report());expect(a.map(x=>[x.source,x.code,x.tick])).toEqual([['fault','EXTERNAL_TRIP',412],['stop','EMERGENCY_STOP',412]]);
  expect(alarmsOf(null)).toEqual([]);expect(alarmsOf({} as RunReport)).toEqual([]);
 });
});
describe('one axis',()=>{
 const input=(r:RunReport|null,cursorTick:number|null=null)=>({report:r,cursorTick,bundle:null});
 test('no report: every tag is unavailable with a reason, never 0',()=>{
  const d=diagnosticsFor('amr-1/wheel-left',input(null));
  for(const t of d.tags){expect(t.value).toBeNull();expect(t.quality).toMatchObject({kind:'unavailable'});}
 });
 test('a report without drive evidence (an R4 run before the drive): "NO_DRIVE_EVIDENCE", and the I/O stream is named missing',()=>{
  const d=diagnosticsFor('amr-1/wheel-left',input({attention:[]} as unknown as RunReport));
  expect(d.tags.find(t=>t.tag==='state')!.quality).toEqual({kind:'unavailable',reason:'NO_DRIVE_EVIDENCE'});
  expect(d.tags.find(t=>t.tag==='io')!.quality).toEqual({kind:'unavailable',reason:'NO_IO_STREAM'});
 });
 test('a drive report: state and fault at the cursor; before the fault there is none',()=>{
  const at=(tick:number|null)=>diagnosticsFor('amr-1/wheel-left',input(report(),tick)).tags;
  expect(at(null).find(t=>t.tag==='state')!.value).toBe('fault');expect(at(null).find(t=>t.tag==='fault')!.value).toBe('EXTERNAL_TRIP');
  expect(at(300).find(t=>t.tag==='state')!.value).toBe('operation_enabled');expect(at(300).find(t=>t.tag==='fault')!.value).toBeNull();
  expect(at(null).find(t=>t.tag==='trackingRms')).toMatchObject({value:0.012,unit:'rad/s',quality:{kind:'good'}});
 });
 test('a metric the report could not measure says why; a cursor past the last tick is stale with its age',()=>{
  const r=diagnosticsFor('amr-1/wheel-right',input(report())).tags.find(t=>t.tag==='trackingRms')!;
  expect(r.value).toBeNull();expect(r.quality).toEqual({kind:'unavailable',reason:'TOO_FEW_SAMPLES'});
  expect(diagnosticsFor('amr-1/wheel-left',input(report(),520)).tags.find(t=>t.tag==='state')!.quality).toEqual({kind:'stale',ageTicks:20});
 });
 test('alarms of the selected axis include the stop; another axis keeps only the stop',()=>{
  expect(diagnosticsFor('amr-1/wheel-left',input(report())).alarms.map(a=>a.source)).toEqual(['fault','stop']);
  expect(diagnosticsFor('amr-1/wheel-right',input(report())).alarms.map(a=>a.source)).toEqual(['stop']);
 });
 test('the device is the one the design names for the axis',()=>{
  const design={devices:[{id:'drive-left',profile:{id:'blvd-krd-v1'}}],axes:[{axisId:'amr-1/wheel-left',driveDeviceId:'drive-left',channel:1,motorDeviceId:null}]} as never;
  const bundle={inputs:{profiles:[{id:'blvd-krd-v1'}]}} as never;
  expect(diagnosticsFor('amr-1/wheel-left',{report:report(),cursorTick:null,bundle,design}).device).toEqual({id:'drive-left',label:'blvd-krd-v1'});
  expect(diagnosticsFor('amr-1/wheel-right',{report:report(),cursorTick:null,bundle,design}).device).toBeNull();
 });
});
describe('panel',()=>{
 test('no health label or green mark; alarms carry an icon, text and a jump to their tick',()=>{
  const d=diagnosticsFor('amr-1/wheel-left',{report:report(),cursorTick:null,bundle:null});
  const html=diagnosticsPanel({targets:[{id:'amr-1/wheel-left',label:'left'},{id:'amr-1/wheel-right',label:'right'}],selected:'amr-1/wheel-left',...d});
  expect(html).not.toMatch(/healthy|khỏe|健全|\bok\b/i);expect(html).toContain('data-action="twin-fault-jump" data-value="412"');expect(html).toContain('EXTERNAL_TRIP');
  expect(html).toContain('<select id="twin-diag-target"');expect(html).toMatch(/data-tag="io" data-quality="unavailable"/);
 });
 test('without a selection the panel asks for one',()=>{expect(diagnosticsPanel({targets:[{id:'a',label:'a'}],selected:null,device:null,tags:[],alarms:[]})).toContain('empty-inline');});
});
describe('stop rows',()=>{
 const rep=(fn:StopReportV1['function'],metrics:object)=>({function:fn,verdict:'fired',appliedTick:412,metrics,invariants:[],decidingParameters:[]}) as unknown as StopReportV1;
 test('a number shows as a number, an unmeasured one as null with its reason, and the order is fixed',()=>{
  const rows=stopRows([rep('emergency',{stopDistanceM:0.796,stopTimeMs:3200,peakDecelerationMps2:0.18,cupMaxSlipMm:2.8,cupTipped:false}),rep('normal',{stopDistanceM:{unavailable:'NOT_AT_REST'},stopTimeMs:{unavailable:'NOT_AT_REST'}})]);
  expect(rows.map(r=>r.function)).toEqual(['normal','emergency']);
  expect(rows[0]).toMatchObject({distanceM:null,why:'NOT_AT_REST'});expect(rows[1]).toMatchObject({distanceM:0.796,timeMs:3200,cupTipped:false,why:null});
  expect(stopRow({...rep('emergency',{}),decidingParameters:[],invariants:[{id:'NO_AUTO_RESTART',result:'violated',detail:''}]} as StopReportV1).violated).toEqual(['NO_AUTO_RESTART']);
 });
});
describe('DGN03: data quality at the cursor',()=>{
 const tags=(id:string,tick:number|null)=>diagnosticsFor(id,{report:report(),cursorTick:tick,bundle:null}).tags;
 test('before the first sample of an axis: unavailable, never its first sample read backwards',()=>{
  for(const t of tags('amr-1/wheel-right',5).filter(t=>t.tag==='state'||t.tag==='fault')){expect(t.value).toBeNull();expect(t.quality).toEqual({kind:'unavailable',reason:'BEFORE_FIRST_SAMPLE'});expect(t.tick).toBeNull();}
 });
 test('at the transition tick: the new state; one tick before: the old one',()=>{
  expect(tags('amr-1/wheel-right',20).find(t=>t.tag==='state')).toMatchObject({value:'operation_enabled',tick:20,quality:{kind:'good'}});
  expect(tags('amr-1/wheel-left',19).find(t=>t.tag==='state')).toMatchObject({value:'disabled',tick:0});
  expect(tags('amr-1/wheel-left',412).find(t=>t.tag==='state')).toMatchObject({value:'fault',tick:412});
 });
 test('after the last sample: stale with its age; at the last tick: still good',()=>{
  expect(tags('amr-1/wheel-right',500).find(t=>t.tag==='state')!.quality).toEqual({kind:'good'});
  expect(tags('amr-1/wheel-right',530).find(t=>t.tag==='state')!.quality).toEqual({kind:'stale',ageTicks:30});
 });
 test('a run without the stream never shows a 0 or a good quality',()=>{
  for(const r of [null,{attention:[]} as unknown as RunReport])for(const t of diagnosticsFor('amr-1/wheel-left',{report:r,cursorTick:5,bundle:null}).tags){expect(t.value).toBeNull();expect(t.quality.kind).toBe('unavailable');}
 });
});
describe('DGN04: alarm marks at the cursor',()=>{
 test('an axis fault marks its wheel, the robot-named stop marks the robot; nothing before its tick',()=>{
  const r=report({attention:[{tick:412,reason:'EMERGENCY_STOP',subjectId:'amr-1'}]});
  expect(alarmMarks(r,411)).toEqual([]);
  expect(alarmMarks(r,412)).toEqual([{entityId:'amr-1',axisId:'amr-1/wheel-left',codes:['EXTERNAL_TRIP']},{entityId:'amr-1',axisId:null,codes:['EMERGENCY_STOP']}]);
  expect(alarmMarks(r,null)).toHaveLength(2);
 });
 test('a stop whose subject is not a robot of the report names no one: listed for every axis, marks nothing',()=>{
  const r=report({attention:[{tick:412,reason:'EMERGENCY_STOP',subjectId:'job-1'}]});
  expect(alarmsOf(r).find(a=>a.source==='stop')!.targetId).toBe('*');expect(alarmMarks(r,null).map(m=>m.axisId)).toEqual(['amr-1/wheel-left']);
 });
});
describe('stop in the run report',()=>{
 const sr={function:'emergency',verdict:'fired',appliedTick:412,metrics:{stopDistanceM:{unavailable:'NOT_AT_REST'}},drives:[{axisId:'amr-1/wheel-left',state:'fault',fault:null}],invariants:[],decidingParameters:[]} as unknown as StopReportV1;
 test('a stop report is the stop alarm (not the attention entry as well) and the stop section',()=>{
  const r=report({stopReport:sr});
  expect(alarmsOf(r).filter(a=>a.source==='stop')).toEqual([{id:'stop:EMERGENCY_STOP:412',source:'stop',targetId:'amr-1',code:'EMERGENCY_STOP',tick:412,verdict:'fired'}]);
  expect(stopOf(r)).toMatchObject({kind:'report'});
  const html=diagnosticsPanel({targets:[{id:'amr-1/wheel-left',label:'left'}],selected:'amr-1/wheel-left',device:null,tags:[],alarms:[],stop:stopOf(r)});
  expect(html).toContain('data-testid="diag-stop" data-quality="good"');expect(html).toContain('NOT_AT_REST');expect(html).toContain('not_calibrated');
 });
 test('an old run that asked for a stop but has no stop report says so; a run without a stop shows no section',()=>{
  const old=report({manifest:{stopSchedule:{entries:[{id:'s1',function:'emergency',trigger:{kind:'elapsed_sim_ms',value:8220}}],hash:'x'}}});
  expect(stopOf(old)).toEqual({kind:'unavailable',reason:'NO_STOP_REPORT',requested:1});
  expect(diagnosticsPanel({targets:[{id:'a',label:'a'}],selected:'a',device:null,tags:[],alarms:[],stop:stopOf(old)})).toContain('data-testid="diag-stop" data-quality="unavailable"');
  expect(stopOf(report())).toEqual({kind:'none'});expect(stopOf(null)).toEqual({kind:'none'});
 });
 test('the design a device is read from is named; a run with no compiled design for its project says no data',()=>{
  const html=(design:{id:string;label:string}|null)=>diagnosticsPanel({targets:[{id:'a',label:'a'}],selected:'a',device:null,tags:[],alarms:[],design});
  expect(html(null)).toContain('data-testid="diag-device" data-quality="unavailable"');
 });
});
