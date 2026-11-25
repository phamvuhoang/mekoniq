import {describe,expect,test} from 'vitest';
import {allocateIo} from '../../packages/lab-runtime/src/engineering/electrical/allocate';
import {BUS_SIGNALS,deriveNetlist,wireId} from '../../packages/lab-runtime/src/engineering/electrical/netlist';
import {shippedContext} from '../support/electrical';

const run=async(option:'serve-hw-a-v1'|'serve-hw-b-v1'|'serve-hw-c-v1',tweak?:Parameters<typeof shippedContext>[1])=>{
 const {context,policy,safety}=await shippedContext(option,tweak),{allocation}=allocateIo(context);
 return {context,allocation,...deriveNetlist(context,allocation,policy,safety)};
};
const ruleIds=(r:{checks:{ruleId:string}[]})=>r.checks.map(c=>c.ruleId);

describe('HW-C netlist',()=>{
 test('the power net runs source, protection, load and every rail has one return net',async()=>{
  const {netlist}=await run('serve-hw-c-v1'),pw=netlist.wires.filter(w=>w.netId==='pwr/rail-24v').map(w=>w.id);
  expect(pw).toContain(wireId('pwr/rail-24v',{deviceId:'battery',pin:'OUT/POS'},{deviceId:'fuse-drive-left',pin:'F/IN'}));
  expect(pw).toContain(wireId('pwr/rail-24v',{deviceId:'fuse-drive-left',pin:'F/OUT'},{deviceId:'drive-left',pin:'CN1/1'}));
  expect(netlist.nets.filter(n=>n.kind==='return'&&n.id==='ret/rail-24v')).toHaveLength(1);
  expect(netlist.wires.filter(w=>w.netId==='ret/rail-24v').length).toBeGreaterThan(5);
 });
 test('a protection device carries the sum of the loads behind it and the wire is sized for it',async()=>{
  const {netlist}=await run('serve-hw-c-v1'),w=netlist.wires.find(x=>x.id.startsWith('pwr/rail-24v:battery.OUT/POS~fuse-logic.F/IN'))!;
  expect(w.currentA!.value).toBeGreaterThan(2);expect(w.csaMm2).toBeGreaterThanOrEqual(0.5);expect(w.csaSource.kind).toBe('assumed');
 });
 test('the CANopen bus chains the members in order with three wires per segment',async()=>{
  const {netlist,context}=await run('serve-hw-c-v1'),members=context.design.buses[0]!.members.length;
  expect(BUS_SIGNALS.canopen).toEqual(['CAN_H','CAN_L','CAN_GND']);
  expect(netlist.wires.filter(w=>w.netId.startsWith('bus/can0/'))).toHaveLength((members-1)*3);
  expect(netlist.nets.filter(n=>n.kind==='bus').map(n=>n.id)).toEqual(['bus/can0/CAN_GND','bus/can0/CAN_H','bus/can0/CAN_L']);
 });
 test('an allocated signal has a signal wire and a return wire; an unallocated one has no net',async()=>{
  const r=await run('serve-hw-c-v1'),a=r.allocation.assigned.find(x=>x.signalId==='bumper-front')!;
  expect(a.deviceId).toBe('io-module');
  expect(r.netlist.wires.filter(w=>w.netId==='sig/bumper-front')).toHaveLength(1);
  expect(r.netlist.wires.some(w=>w.netId.startsWith('sigret/io-module.IO/COM'))).toBe(true);
  expect(r.netlist.nets.some(n=>n.id==='sig/brake-release')).toBe(false);        // brake-release is optional and has no point on these drives
 });
 test('every axis has a motor cable and an encoder cable; USB and Ethernet would be cables, not wires',async()=>{
  const {netlist}=await run('serve-hw-c-v1');
  expect(netlist.cables.map(c=>`${c.kind}`).sort()).toEqual(['encoder','encoder','motor','motor']);
 });
 test('output arrays are sorted by id',async()=>{
  const {netlist}=await run('serve-hw-c-v1');
  for(const list of [netlist.nets,netlist.wires,netlist.cables]){const ids=list.map(x=>x.id);expect(ids).toEqual([...ids].sort());}
 });
});

describe('safety',()=>{
 test('a requirement that names safety-chain signals yields a review net with the authors end points and no wire',async()=>{
  const {netlist}=await run('serve-hw-a-v1'),n=netlist.nets.find(x=>x.kind==='safety')!;
  expect(n.id).toBe('safety/req-estop');expect(n.reviewRequired).toBe(true);
  expect(n.nodes.map(x=>`${x.deviceId}.${x.pin}`)).toEqual(expect.arrayContaining(['estop-button.C/S1','estop-button.C/S2','drive-left.CN4/11','drive-right.CN4/27']));
  expect(netlist.wires.some(w=>w.netId.startsWith('safety/'))).toBe(false);
 });
 test('a requirement that names devices the design does not have is not listed',async()=>{
  const {netlist}=await run('serve-hw-b-v1');
  expect(netlist.nets.filter(x=>x.kind==='safety').map(x=>x.id)).toEqual(['safety/req-estop-contactor']);
 });
});

describe('structural errors are blocking checks',()=>{
 test('a field pin that the profile does not have',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,signals:d.signals.map(s=>s.id==='bumper-front'?{...s,field:{...s.field,pin:'ZZ'}}:s)}));
  expect(r.checks.filter(c=>c.ruleId==='ELD_PIN_UNKNOWN').map(c=>c.path)).toContain('/signals/bumper-front/field/pin');
 });
 test('two signals wired to the same field pin reuse it',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,signals:d.signals.map(s=>s.id==='bumper-left'?{...s,field:{...s.field,deviceId:'bumper-front-sw'}}:s)}));
  expect(ruleIds(r)).toContain('ELD_PIN_REUSED');
 });
 test('a bus member without an interface of the same protocol',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,buses:d.buses.map(b=>({...b,protocol:'modbus_rtu' as const}))}));
  expect(ruleIds(r)).toContain('ELD_BUS_PROTOCOL_MISMATCH');
 });
 test('two members at one address',async()=>{
  const r=await run('serve-hw-c-v1',d=>({...d,buses:d.buses.map(b=>({...b,members:b.members.map(m=>m.deviceId==='io-module'?{...m,address:1}:m)}))}));
  expect(ruleIds(r)).toContain('ELD_BUS_ADDRESS_DUPLICATE');
 });
 test('a drive without a CAN ground pin only warns (ZLAC8015D lists CANH and CANL only)',async()=>{
  const r=await run('serve-hw-b-v1');
  expect(r.checks.filter(c=>c.ruleId==='ELD_BUS_GROUND_UNKNOWN').every(c=>c.level==='warning')).toBe(true);
  expect(r.checks.some(c=>c.ruleId==='ELD_PIN_UNKNOWN'&&c.path.startsWith('/buses'))).toBe(false);
 });
});

// ids are made of the net and its end points, so they stay put while the allocation does; a signal that sorts after the others cannot move them
test('stable ids: adding a signal keeps every existing wire id',async()=>{
 const before=await run('serve-hw-c-v1');
 const after=await run('serve-hw-c-v1',d=>({...d,signals:[...d.signals,{...d.signals.find(s=>s.id==='bumper-left')!,id:'zz-extra',field:{deviceId:'cover-sw',pin:'1',returnPin:'2'}}]}));
 const ids=new Set(after.netlist.wires.map(w=>w.id));
 for(const w of before.netlist.wires)if(w.netId!=='sig/cover-switch'&&!w.netId.startsWith('sigret/'))expect(ids.has(w.id),w.id).toBe(true);
});
test('deriveNetlist is deterministic',async()=>{
 const a=await run('serve-hw-b-v1'),b=await run('serve-hw-b-v1');
 expect(JSON.stringify(a.netlist)).toBe(JSON.stringify(b.netlist));
});
