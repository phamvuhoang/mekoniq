import {describe,expect,test} from 'vitest';
import compiled from '../fixtures/electrical-bundle-hw-c.json' with {type:'json'};
import blocked from '../fixtures/electrical-bundle-hw-a-blocked.json' with {type:'json'};
import {costRows,electricalView,pinSignal,serveOptions,wireRows,ELECTRICAL_CAPABILITY} from '../../src/design/electrical';
import {wiringDiagramSvg} from '../../src/ui/wiring-diagram';
import type {ElectricalBundleV1,TcoComparisonV1} from '../../src/shared/engineering';

const C=compiled as unknown as ElectricalBundleV1,A=blocked as unknown as ElectricalBundleV1,caps=[ELECTRICAL_CAPABILITY];
const view=(o:Partial<Parameters<typeof electricalView>[0]>)=>electricalView({capabilities:caps,bundle:null,rejection:null,busy:false,...o});

describe('state',()=>{
 test('no runtime, an older runtime, idle and compiling',()=>{
  expect(view({capabilities:null}).state).toBe('no_runtime');
  expect(view({capabilities:['engineering_bundle_v1']}).state).toBe('unsupported');
  expect(view({}).state).toBe('idle');expect(view({busy:true}).state).toBe('compiling');
 });
 test('a blocked bundle is blocked with blocking checks and still lists its devices and checks',()=>{
  const v=view({bundle:A});expect(v.state).toBe('blocked');expect(v.counts.blocking).toBeGreaterThan(0);
  expect(v.checks.length).toBe(A.checks.length);expect(v.devices.length).toBeGreaterThan(0);
 });
 test('a compiled bundle has no blocking item; counts equal the bundle',()=>{
  const v=view({bundle:C});expect(v.state).toBe('compiled');expect(v.counts.blocking).toBe(0);
  expect(v.counts.unverified).toBe(C.checks.filter(c=>c.level==='unverified').length);
 });
 test('the server\'s rejection codes are copied',()=>{expect(view({rejection:['IOA_PINNED_CONFLICT']})).toMatchObject({state:'rejected',rejection:['IOA_PINNED_CONFLICT']});});
});
test('the device level is the bundle\'s own, not one the profile suggests',()=>{
 const forged=structuredClone(C);forged.inputs.profiles[0]!.evidenceLevel=forged.inputs.profiles[0]!.evidenceLevel==='documented'?'candidate':'documented';
 expect(view({bundle:forged}).devices[0]!.level).toBe(forged.inputs.profiles[0]!.evidenceLevel);
 expect(view({bundle:C}).devices.map(d=>d.level)).toEqual(C.inputs.profiles.map(p=>p.evidenceLevel));
});
test('the three options come from the synced fixture',()=>{expect(serveOptions().map(o=>o.id)).toEqual(['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1']);});

describe('pinning and rows',()=>{
 const d=serveOptions()[2]!.design;
 test('pinSignal bumps the revision, changes only that signal and leaves the argument alone',()=>{
  const before=JSON.stringify(d),p=pinSignal(d,'bumper-front',{deviceId:'io-module',pointId:'DI-5'});
  expect(p.revision).toBe(d.revision+1);expect(JSON.stringify(d)).toBe(before);
  expect(p.signals.find(s=>s.id==='bumper-front')!.pinned).toEqual({deviceId:'io-module',pointId:'DI-5'});
  expect(p.signals.filter(s=>s.id!=='bumper-front')).toEqual(d.signals.filter(s=>s.id!=='bumper-front'));
  expect(pinSignal(p,'bumper-front',null).signals.find(s=>s.id==='bumper-front')!.pinned).toBeNull();
  expect(()=>pinSignal(d,'nope',null)).toThrow('SIGNAL_UNKNOWN');
 });
 test('wireRows filters by net and device and keeps the bundle order',()=>{
  const all=wireRows(C,{}),n=C.netlist.wires[0]!.netId;
  expect(all.map(r=>r.id)).toEqual(C.netlist.wires.map(w=>w.id));
  expect(wireRows(C,{netId:n}).every(r=>r.netId===n)).toBe(true);
  const dev=C.netlist.wires[0]!.from.deviceId;expect(wireRows(C,{deviceId:dev}).every(r=>r.from.startsWith(dev+':')||r.to.startsWith(dev+':'))).toBe(true);
 });
 test('cost rows show no total for options that do not compare, and count the missing prices',()=>{
  const c={assumptionsDigest:'a'.repeat(64),options:[{designId:'x',bundleDigest:'b'.repeat(64),comparable:false,missingPriceLineIds:['a','b'],parts:{},total:12},{designId:'y',bundleDigest:'c'.repeat(64),comparable:true,missingPriceLineIds:[],parts:{},total:5}],dominant:null,notComparableReason:'PRICE_MISSING_FOR_DECIDING_PARTS'} as unknown as TcoComparisonV1;
  expect(costRows(c)).toEqual([{designId:'x',total:null,comparable:false,missing:2},{designId:'y',total:5,comparable:true,missing:0}]);expect(costRows(null)).toEqual([]);
 });
});

describe('wiring diagram',()=>{
 test('is deterministic, one group per device, one path per bus and rail, titles throughout',()=>{
  const a=wiringDiagramSvg(C,id=>id),b=wiringDiagramSvg(C,id=>id);expect(a).toBe(b);
  const devices=new Set(C.netlist.nets.flatMap(n=>n.nodes.map(x=>x.deviceId)));
  expect((a.match(/<g data-device-id=/g)??[]).length).toBe(devices.size);
  expect((a.match(/<path data-net-id=/g)??[]).length).toBe(C.netlist.nets.filter(n=>n.kind==='bus'||n.kind==='power').length);
  expect((a.match(/<title>/g)??[]).length).toBe(devices.size*1+C.netlist.nets.filter(n=>n.kind==='bus'||n.kind==='power').length);
 });
 test('labels are escaped',()=>{expect(wiringDiagramSvg(C,()=>'<b>"x"</b>')).not.toContain('<b>');});
});

import {electricalPanel} from '../../src/ui/electrical-panel';
describe('panel',()=>{
 const base={options:serveOptions().map(o=>({id:o.id,label:o.label})),optionId:'serve-hw-a-v1',design:serveOptions()[0]!.design,filter:'all' as const,selectedWire:null,compare:null,compareError:'',busy:false,packaging:false};
 test('an older runtime shows the plain sentence and no compile or export',()=>{
  const html=electricalPanel({...base,bundle:null,view:view({capabilities:['engineering_bundle_v1']})});
  expect(html).toContain('data-state="unsupported"');expect(html).not.toContain('el-package');expect(html).toMatch(/data-action="el-compile" disabled/);
 });
 test('a blocked bundle still shows allocation and checks; export is disabled with a readable reason',()=>{
  const html=electricalPanel({...base,bundle:A,view:view({bundle:A})});
  expect(html).toContain('data-testid="el-allocation"');expect(html).toContain('data-testid="el-checks"');expect(html).toMatch(/data-action="el-package" disabled/);
  expect(html).toMatch(/data-testid="el-why">[^<]*\d+/);expect(html).toContain('data-unassigned');
 });
 test('a compiled bundle enables export; cost says not comparable when there are no prices',()=>{
  const html=electricalPanel({...base,optionId:'serve-hw-c-v1',bundle:C,view:view({bundle:C}),compare:{assumptionsDigest:'a'.repeat(64),options:[{designId:'serve-hw-c-v1',bundleDigest:'b'.repeat(64),comparable:false,missingPriceLineIds:['x'],parts:{} as never,total:null},{designId:'serve-hw-b-v1',bundleDigest:'c'.repeat(64),comparable:false,missingPriceLineIds:[],parts:{} as never,total:null}],dominant:null,notComparableReason:'PRICE_MISSING_FOR_DECIDING_PARTS'}});
  expect(html).not.toMatch(/data-action="el-package" disabled/);expect(html).toMatch(/chưa so được|比較不可|not comparable/);expect(html).toContain('PRICE_MISSING_FOR_DECIDING_PARTS');
 });
});
