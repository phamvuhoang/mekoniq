import {describe,expect,test} from 'vitest';
import {allocateIo,candidatePoints,IO_COMPATIBILITY} from '../../packages/lab-runtime/src/engineering/electrical/allocate';
import {allocContext,point,signal} from '../support/electrical';

const sig=(o:Parameters<typeof signal>[0]={})=>signal({field:{deviceId:'controller',pin:'1',returnPin:null},...o});
const reasons=(ctx:ReturnType<typeof allocContext>,s=ctx.design.signals[0]!)=>{const r=candidatePoints(s,ctx);return 'rejected' in r?r.rejected.map(x=>x.code):[];};

test('two signals competing for the only valid point: one is assigned, the other explains why not',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1'})],signals:[sig({id:'bumper-front'}),sig({id:'dock-detect'})]});
 const {allocation}=allocateIo(ctx);
 expect(allocation.assigned.map(a=>a.signalId)).toEqual(['bumper-front']);
 expect(allocation.unassigned).toEqual([{signalId:'dock-detect',reasons:[{code:'NO_FREE_POINT',candidates:1}]}]);
 expect(allocateIo(allocContext({points:[point({pointId:'IN1'})],signals:[sig({id:'dock-detect'}),sig({id:'bumper-front'})]})).allocation).toEqual(allocation);
});

describe('each reason has a case',()=>{
 test('no device on the controller bus',()=>{expect(reasons(allocContext({moduleOnBus:false}))).toEqual(['NO_CANDIDATE_DEVICE']);});
 test('only a point of the wrong direction',()=>{expect(reasons(allocContext({points:[point({direction:'output',electrical:{type:'pnp_source_output',voltageRangeV:[12,30],maxCurrentA:{value:1,unit:'A',source:point().source}}})]}))).toContain('DIRECTION_MISMATCH');});
 test('a point type that cannot take the field type',()=>{expect(reasons(allocContext({points:[point({electrical:{type:'npn_source_input',voltageRangeV:[12,30],maxCurrentA:null}})],signals:[sig({electrical:{type:'pnp_source_output',nominalV:24,currentA:signal().electrical.currentA}})]}))).toEqual(['ELECTRICAL_MISMATCH']);});
 test('24 V on a 5 V point',()=>{expect(reasons(allocContext({points:[point({electrical:{type:'pnp_sink_input',voltageRangeV:[5,5],maxCurrentA:null}})]}))).toEqual(['VOLTAGE_OUT_OF_RANGE']);});
 test('a 0.2 A load on a 10 mA output',()=>{
  const out=point({pointId:'OUT1',direction:'output',electrical:{type:'pnp_source_output',voltageRangeV:[12,30],maxCurrentA:{value:0.01,unit:'A',source:point().source}}});
  expect(reasons(allocContext({points:[out],signals:[sig({direction:'output',electrical:{type:'pnp_sink_input',nominalV:24,currentA:{value:0.2,unit:'A',source:point().source}}})]}))).toEqual(['OUTPUT_OVERCURRENT']);
 });
 test('a point that cannot be reassigned and carries another function',()=>{expect(reasons(allocContext({points:[point({reassignable:false,defaultFunction:'STOP',functions:['STOP']})]}))).toEqual(['POINT_RESERVED']);});
 test('a point that is not on the bus',()=>{expect(reasons(allocContext({points:[point({busExposure:{kind:'none',object:null,bit:null,precondition:null,updatePeriodMs:null}})]}))).toEqual(['NOT_BUS_EXPOSED']);});
 test('an acyclic point slower than the signal needs',()=>{expect(reasons(allocContext({points:[point({busExposure:{kind:'acyclic',object:'6000:01',bit:0,precondition:null,updatePeriodMs:100}})],signals:[sig({maxLatencyMs:40})]}))).toEqual(['LATENCY_EXCEEDED']);});
 test('a cyclic point on a bus slower than the signal needs',()=>{expect(reasons(allocContext({cycleMs:100,signals:[sig({maxLatencyMs:40})]}))).toEqual(['LATENCY_EXCEEDED']);});
 test('a point that carries a safety claim',()=>{expect(reasons(allocContext({points:[point({safety:{function:'safe_input',claim:'x',documentId:'safety-manual',locator:'1',certificate:null}})]}))).toContain('SAFETY_POINT_RESERVED');});
});

test('the result does not depend on declaration order',()=>{
 const ps=[point({pointId:'IN1'}),point({pointId:'IN2'}),point({pointId:'IN3'})],ss=['a','b','c'].map(id=>sig({id}));
 const one=allocateIo(allocContext({points:ps,signals:ss}));
 const two=allocateIo(allocContext({points:[...ps].reverse(),signals:[...ss].reverse()}));
 expect(JSON.stringify(two)).toBe(JSON.stringify(one));expect(JSON.stringify(allocateIo(allocContext({points:ps,signals:ss})))).toBe(JSON.stringify(one));
});
test('the latency of each signal decides which point it can take',()=>{
 const a=point({pointId:'IN1'}),b=point({pointId:'IN2',busExposure:{kind:'acyclic',object:'6000:02',bit:1,precondition:null,updatePeriodMs:5}});
 const ctx=allocContext({points:[a,b],signals:[sig({id:'fast',maxLatencyMs:5}),sig({id:'slow',maxLatencyMs:50})]});
 expect(allocateIo(ctx).allocation.assigned.map(x=>`${x.signalId}:${x.pointId}`)).toEqual(['fast:IN2','slow:IN1']);
});
test('a valid pin is kept even when another point would sort first',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1'}),point({pointId:'IN2'})],signals:[sig({id:'bumper',pinned:{deviceId:'io',pointId:'IN2'}})]});
 expect(allocateIo(ctx).allocation.assigned).toEqual([{signalId:'bumper',deviceId:'io',pointId:'IN2',busId:'can0',exposure:'cyclic',pinned:true}]);
});
test('a pin onto a point with another function is a blocking conflict and the signal stays unassigned',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1',reassignable:false,defaultFunction:'STOP',functions:['STOP']})],signals:[sig({id:'bumper',pinned:{deviceId:'io',pointId:'IN1'}})]});
 const r=allocateIo(ctx);
 expect(r.checks.filter(c=>c.level==='blocking').map(c=>c.ruleId)).toEqual(['IOA_PINNED_CONFLICT']);
 expect(r.allocation.assigned).toEqual([]);expect(r.allocation.unassigned.map(u=>u.signalId)).toEqual(['bumper']);
});
test('two pins on one point conflict',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1'})],signals:[sig({id:'a',pinned:{deviceId:'io',pointId:'IN1'}}),sig({id:'b',pinned:{deviceId:'io',pointId:'IN1'}})]});
 expect(allocateIo(ctx).checks.filter(c=>c.ruleId==='IOA_PINNED_CONFLICT')).toHaveLength(1);
});
test('a safety-chain signal never appears in the allocation and consumes no point',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1'})],signals:[sig({id:'estop-chain',consumer:'safety_chain',maxLatencyMs:null}),sig({id:'bumper'})]});
 const {allocation}=allocateIo(ctx);
 expect(allocation.assigned.map(a=>a.signalId)).toEqual(['bumper']);
 expect(JSON.stringify(allocation)).not.toContain('estop-chain');
});
test('a required signal without a point blocks; an optional one only warns',()=>{
 const ctx=allocContext({points:[],signals:[sig({id:'must',required:true}),sig({id:'maybe',required:false})]});
 const checks=allocateIo(ctx).checks.filter(c=>c.ruleId==='IOA_SIGNAL_UNALLOCATED');
 expect(checks.map(c=>[c.path,c.level])).toEqual([['/signals/maybe','warning'],['/signals/must','blocking']]);
});
test('a volatile assignment warns and a device with no spare point of that direction warns',()=>{
 const ctx=allocContext({points:[point({pointId:'IN1',assignmentPersistence:'volatile'})],signals:[sig({id:'bumper'})]});
 expect(allocateIo(ctx).checks.map(c=>c.ruleId)).toEqual(['IOA_ASSIGNMENT_VOLATILE','IOA_SPARE_LOW']);
});
test('the compatibility table covers every electrical type',()=>{expect(Object.keys(IO_COMPATIBILITY).sort()).toEqual(['analog_current','analog_voltage','dry_contact_input','isolated_transistor_output','npn_sink_output','npn_source_input','pnp_sink_input','pnp_source_output','relay_output']);});

describe('a latency limit must be proven by a known period (IOA01)',()=>{
 const acyclic=(updatePeriodMs:number|null)=>point({pointId:'IN1',busExposure:{kind:'acyclic',object:'6000:01',bit:0,precondition:null,updatePeriodMs}});
 const bumper=(maxLatencyMs:number|null,pinned:{deviceId:string;pointId:string}|null=null)=>sig({id:'bumper-front',maxLatencyMs,pinned});
 const assigned=(ctx:ReturnType<typeof allocContext>)=>allocateIo(ctx).allocation.assigned.map(a=>`${a.signalId}:${a.pointId}`);
 test('auto-assign: period equal to the limit is accepted, above it is rejected, unknown is rejected, no limit needs no period',()=>{
  expect(assigned(allocContext({points:[acyclic(40)],signals:[bumper(40)]}))).toEqual(['bumper-front:IN1']);
  expect(reasons(allocContext({points:[acyclic(41)],signals:[bumper(40)]}))).toEqual(['LATENCY_EXCEEDED']);
  expect(reasons(allocContext({points:[acyclic(null)],signals:[bumper(40)]}))).toEqual(['LATENCY_UNKNOWN']);
  expect(allocateIo(allocContext({points:[acyclic(null)],signals:[bumper(40)]})).allocation.unassigned).toEqual([{signalId:'bumper-front',reasons:[{code:'LATENCY_UNKNOWN',candidates:1}]}]);
  expect(assigned(allocContext({points:[acyclic(null)],signals:[bumper(null)]}))).toEqual(['bumper-front:IN1']);
  expect(assigned(allocContext({cycleMs:40,signals:[bumper(40)]}))).toEqual(['bumper-front:IN1']);
 });
 test('pinned: a pin onto a point of unknown period is a blocking conflict naming LATENCY_UNKNOWN',()=>{
  const r=allocateIo(allocContext({points:[acyclic(null)],signals:[bumper(40,{deviceId:'io',pointId:'IN1'})]}));
  expect(r.allocation.assigned).toEqual([]);
  expect(r.checks.filter(c=>c.ruleId==='IOA_PINNED_CONFLICT').map(c=>c.detail)).toEqual([expect.stringContaining('LATENCY_UNKNOWN')]);
  expect(allocateIo(allocContext({points:[acyclic(40)],signals:[bumper(40,{deviceId:'io',pointId:'IN1'})]})).allocation.assigned.map(a=>a.pinned)).toEqual([true]);
  expect(allocateIo(allocContext({points:[acyclic(null)],signals:[bumper(null,{deviceId:'io',pointId:'IN1'})]})).allocation.assigned.map(a=>a.pinned)).toEqual([true]);
 });
});
