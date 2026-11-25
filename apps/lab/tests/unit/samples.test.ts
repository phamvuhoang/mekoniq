import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {loadHardwareSample,loadStopSample,validEntry,verifySample,type SampleEntry} from '../../src/reports/samples';
import {stopRows} from '../../src/reports/stop';

const root=join(__dirname,'../../public');
const bytes=async(p:string)=>new Uint8Array(await readFile(join(root,p)));
const catalog=async()=>JSON.parse(await readFile(join(root,'samples/catalog.json'),'utf8')) as SampleEntry[];

describe('shipped samples',()=>{
 test('the catalog has the two samples, each not calibrated and not accepted',async()=>{
  const c=await catalog();expect(c.map(e=>e.id)).toEqual(['hardware-candidate','stop-report']);expect(c.every(validEntry)).toBe(true);
 });
 test('both read back byte for byte',async()=>{for(const e of await catalog())expect(await verifySample(e,bytes)).toEqual({ok:true,mismatched:[]});});
 test('one changed byte names its file; a changed manifest is the manifest',async()=>{
  const [hw,stop]=await catalog() as [SampleEntry,SampleEntry];
  const flip=(target:string)=>async(p:string)=>{const b=await bytes(p);if(p.endsWith(target)){const c=new Uint8Array(b);c[5]=c[5]!^1;return c;}return b;};
  expect(await verifySample(hw,flip('documents/wire-list.csv'))).toEqual({ok:false,mismatched:['documents/wire-list.csv']});
  expect(await verifySample(stop,flip('s1-normal.json'))).toEqual({ok:false,mismatched:['s1-normal.json']});
  expect(await verifySample(hw,flip('hardware-candidate/manifest.json'))).toEqual({ok:false,mismatched:[hw.manifest]});
  expect(await verifySample(hw,async()=>{throw new Error('x');})).toEqual({ok:false,mismatched:[hw.manifest]});
 });
 test('an entry without accepted:false or with a calibration is refused',async()=>{
  const [hw]=await catalog() as [SampleEntry];
  expect(validEntry({...hw,accepted:true})).toBe(false);expect(validEntry({...hw,calibration:'calibrated'})).toBe(false);expect(validEntry({...hw,sha256:'zz'})).toBe(false);expect(validEntry(null)).toBe(false);
 });
 test('the hardware sample is a draft with the three constants and readiness, and loads its bundle, design and profiles',async()=>{
  const [hw]=await catalog() as [SampleEntry],s=await loadHardwareSample(hw,bytes);
  expect([s.manifest.status,s.manifest.hardwareValidated,s.manifest.controlAuthority]).toEqual(['draft',false,false]);
  expect(s.bundle.state).toBe('compiled');expect(s.profiles.size).toBeGreaterThan(5);expect(s.checklist).toContain('UNVERIFIED');
  expect(s.manifest.readiness.filter(r=>r.status==='blocked_external').length).toBe(2);
 });
 test('the stop sample shows four kinds side by side with a distance for each, and the limits',async()=>{
  const [,stop]=await catalog() as [SampleEntry,SampleEntry],rows=stopRows(await loadStopSample(stop,bytes));
  expect(rows.map(r=>`${r.function}${r.function==='emergency'?':'+r.onDisable:''}`)).toEqual(['normal','protective','emergency:brake','emergency:coast']);
  expect(rows.every(r=>r.distanceM!==null&&r.verdict==='fired')).toBe(true);
  const reports=await loadStopSample(stop,bytes);expect(reports.every(r=>r.accepted===false&&r.calibration==='not_calibrated')).toBe(true);expect(reports[0]!.limits.length).toBeGreaterThan(0);
 });
});
