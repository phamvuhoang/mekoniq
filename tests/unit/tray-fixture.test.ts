import {createHash} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
// @ts-expect-error plain ESM generator, no declaration file
import {generateTrayFixture} from '../../scripts/generate-tray-fixture.mjs';

const dir=join(__dirname,'../../robotics/simulation-mujoco/fixtures/serve-tray-v1'),payload=join(__dirname,'../../robotics/simulation-mujoco/fixtures/serve-payload-v1');
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const read=async(f:string,d=dir)=>JSON.parse(await readFile(join(d,f),'utf8'));
const COMMON=['serve-3d-project.json','serve-3d-components.json','physical-model-amr-1.json','world3d.json','assumptions.json','drive-contact-profile.json'];

test('generating twice gives identical bytes, and the committed fixture is what the generator writes',async()=>{
 const a=await mkdtemp(join(tmpdir(),'tray-a-')),b=await mkdtemp(join(tmpdir(),'tray-b-'));
 try{
  await generateTrayFixture(a);await generateTrayFixture(b);
  const names=(await readdir(a)).sort();expect(names).toEqual((await readdir(b)).sort());expect(names).toEqual((await readdir(dir)).sort());
  for(const n of names){const x=await readFile(join(a,n));expect(sha(x)).toBe(sha(await readFile(join(b,n))));expect(sha(x),n).toBe(sha(await readFile(join(dir,n))));}
 }finally{await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true});}
});

test('what the tray shares with serve-payload-v1 is byte for byte the same file',async()=>{
 for(const n of COMMON)expect(sha(await readFile(join(dir,n))),n).toBe(sha(await readFile(join(payload,n))));
 const m=await read('manifest.json');expect(m.files.map((f:{path:string})=>f.path)).toEqual(expect.arrayContaining([...COMMON,'cup-triple.json','cup-triple-low-friction.json','drive-contact-tray-low-v1.json','tray-policy-v1.json','actor-proxy-v1.json','feasibility.json','registered-physics.json']));
 for(const f of m.files)expect(sha(await readFile(join(dir,f.path))),f.path).toBe(f.sha256);
});

for(const name of ['cup-triple','cup-triple-low-friction']){
 test(`${name}: three free cups on the tray, not touching each other, inside the support polygon after margin`,async()=>{
  const load=await read(`${name}.json`),support=load.supports[0],poly=support.polygonM as number[][];
  expect(load.props.map((p:{propId:string})=>p.propId)).toEqual(['cup-1','cup-2','cup-3']);
  for(const p of load.props)expect(p.attachment).toMatchObject({kind:'free',supportId:'amr-1/tray-1'});
  const at=load.props.map((p:{attachment:{initialPoseInSupport:{positionM:number[]}}})=>p.attachment.initialPoseInSupport.positionM),r=load.props[0].geometry.radiusM,h=load.props[0].geometry.heightM;
  expect(at).toEqual([[-0.1,-0.09,h/2],[0.1,-0.09,h/2],[0,0.1,h/2]]);
  for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)expect(Math.hypot(at[i]![0]!-at[j]![0]!,at[i]![1]!-at[j]![1]!)).toBeGreaterThan(2*r+0.02);
  for(const p of at)poly.forEach((v,i)=>{const w=poly[(i+1)%poly.length]!,e=[w[0]!-v[0]!,w[1]!-v[1]!],n=Math.hypot(...e),d=(e[0]!*(p[1]!-v[1]!)-e[1]!*(p[0]!-v[0]!))/n;expect(d).toBeGreaterThan(r+0.005);});
  expect(load.calibration).toBe('not_calibrated');
 });
}

test('the low-friction profile lowers the cup and the tray contact together, and its lock matches the worker rule',async()=>{
 const base=await read('cup-triple.json'),low=await read('cup-triple-low-friction.json'),pb=await read('drive-contact-profile.json'),pl=await read('drive-contact-tray-low-v1.json');
 expect(base.props.every((p:{friction:{sliding:number}})=>p.friction.sliding===0.6)).toBe(true);
 expect(low.props.every((p:{friction:{sliding:number}})=>p.friction.sliding===0.15)).toBe(true);
 expect(pb.contact.sliding).toBe(0.6);expect(pl.contact.sliding).toBe(0.15);
 const {id:_i,digest:_d,contact:_c,sources:_s,measurementLock:_m,...restB}=pb,{id:_i2,digest:_d2,contact:_c2,sources:_s2,measurementLock:_m2,...restL}=pl;void [_i,_d,_c,_s,_m,_i2,_d2,_c2,_s2,_m2];
 expect(restL).toEqual(restB);
 const reg=await read('registered-physics.json');expect(Object.keys(reg)).toEqual(['drive-contact-tray-low-v1']);
 expect(reg['drive-contact-tray-low-v1'].sha256).toBe(sha(await readFile(join(dir,'drive-contact-tray-low-v1.json'))));
 expect(pl.measurementLock.probeId).toBe('v10-tray-low-friction');
});

test('feasibility records the geometry and the effective friction of the cup-tray pair as max(cup, tray)',async()=>{
 const f=await read('feasibility.json');
 expect(f.accepted).toBe(false);expect(f.calibration).toBe('not_calibrated');
 for(const l of f.layouts){
  expect(l.cupCupMinCenterDistanceM).toBeGreaterThan(2*l.cupRadiusM);expect(l.cupEdgeMinClearanceM).toBeGreaterThan(0.005);
  expect(l.effectiveFriction).toBe(Math.max(l.cupSliding,l.traySliding));
 }
 expect(f.layouts.map((l:{id:string;effectiveFriction:number})=>[l.id,l.effectiveFriction])).toEqual([['cup-triple',0.6],['cup-triple-low-friction',0.15]]);
});

test('the policy and the actor proxy are declared, assumed and not calibrated',async()=>{
 const p=await read('tray-policy-v1.json'),a=await read('actor-proxy-v1.json');
 expect(p).toMatchObject({id:'tray-policy-v1',calibration:'not_calibrated',slipWarnM:0.005,slipFailM:0.02});
 expect(p.accelerationToleranceAboveMps2).toBeGreaterThan(0);expect(p.accelerationToleranceBelowMps2).toBeGreaterThan(p.accelerationToleranceAboveMps2);expect(p.slipWindowTicks).toBe(25);expect(p.slipEpsilonM).toBeGreaterThanOrEqual(p.slipWarnM);
 expect(a).toMatchObject({id:'actor-proxy-v1',shape:'box',heightM:1.7,calibration:'not_calibrated'});
});
