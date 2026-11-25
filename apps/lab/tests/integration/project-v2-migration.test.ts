import 'fake-indexeddb/auto';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ProjectStore} from '../../src/project/store';
import {validateProjectV2,validateProject} from '../../src/project/schema';
import {migrateV1Project} from '../../src/project/migrations/v1-v2';
import {compileAsset,assetContentHash,verifyAssetHash,sealAsset,serviceAmrAsset,SERVICE_AMR_ITEMS} from '../../src/twin/model';
import {buildFrameGraph,transformPose,sourceFrame,quaternionFromYaw,type FrameDef,type Pose} from '../../src/twin/frames';
import {sha256Hex,canonicalJson,hashJson} from '../../src/twin/hash';
import {footprintForDesign} from '../../src/design/catalog';
import {defaultProject} from '../../src/project/default';
import type {AssetRevision,LabProject} from '../../src/shared/types';

const fx=(n:string)=>JSON.parse(readFileSync(new URL(`../../fixtures/twins/${n}`,import.meta.url),'utf8'));
const v1:{service:LabProject;valetudo:LabProject}=fx('v1-legacy.json'),restaurant=fx('restaurant-v2.json'),cell=fx('coffee-cell-v2.json'),negative=fx('negative-v2.json');
const code=(fn:()=>unknown)=>{try{fn();}catch(e){return (e as {code?:string}).code??(e as Error).message;}return 'NO_THROW';};
const near=(a:readonly number[],b:readonly number[],tol=1e-9)=>a.forEach((v,i)=>expect(Math.abs(v-b[i]!)).toBeLessThanOrEqual(tol));
const rng=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const S=Math.SQRT1_2;
const stores:ProjectStore[]=[];
const fresh=(name=`v2-${crypto.randomUUID()}`)=>{const s=new ProjectStore(name);stores.push(s);return s;};
afterEach(async()=>{vi.restoreAllMocks();for(const s of stores.splice(0))await s.close();});

describe('v1 -> v2 migration (pure)',()=>{
 it('keeps handoff coordinates, marks geometry illustrative and never invents physics',()=>{
  const result=migrateV1Project({...v1.service,world:{...v1.service.world,points:[{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:2}]}});
  expect(result.projectV2.world.handoffPoints![0]!.position).toEqual([1,2,0]);
  expect(result.warnings).toContain('GEOMETRY_ILLUSTRATIVE');
  expect(compileAsset(sealAsset({...result.assets[0]!,inertial:undefined,provenance:[{parameter:'geometry',source:'assumed'}]})).capabilities.dynamics).toBe(false);
 });
 it('reproduces the source-generated fixture byte for byte, so the Lab hash equals the source hash',()=>{
  const r=migrateV1Project(v1.service);
  expect(r.projectV2).toEqual(restaurant.project);expect(r.assets).toEqual(restaurant.assets);expect(r.warnings).toEqual(restaurant.warnings);
  for(const a of [...restaurant.assets,...cell.assets] as AssetRevision[])expect(verifyAssetHash(a),a.id).toBe(true);
  expect(validateProjectV2(restaurant.project)).toEqual(restaurant.project);expect(validateProjectV2(cell.project)).toEqual(cell.project);
 });
 it('Valetudo has no footprint, no inertia and no dynamics capability',()=>{
  const r=migrateV1Project(v1.valetudo),a=r.assets[0]!,c=compileAsset(a);
  expect(a.geometry).toEqual([]);expect(a.inertial).toBeUndefined();expect(r.warnings).toContain('FOOTPRINT_UNKNOWN');expect(r.warnings).not.toContain('GEOMETRY_ILLUSTRATIVE');
  expect(c.capabilities.dynamics).toBe(false);expect(c.collision.footprint).toBeNull();expect(c.capabilities.unknown.map(u=>u.parameter)).toEqual(expect.arrayContaining(['inertial.massKg','geometry']));
 });
 it('does not mutate v1 and refuses bad input before returning anything',()=>{
  const copy=structuredClone(v1.service);migrateV1Project(v1.service);expect(v1.service).toEqual(copy);
  expect(code(()=>migrateV1Project(negative.v1BadId))).toBe('MIGRATION_ID_INVALID');
  expect(code(()=>migrateV1Project({...v1.service,schemaVersion:2} as never))).toBe('MIGRATION_INVALID_V1');
 });
});

describe('asset model service (single geometry source)',()=>{
 it('the catalog fixture, the compiled footprint and the viewer source agree',()=>{
  const catalog=JSON.parse(readFileSync(new URL('../../fixtures/catalog/service-illustrative.json',import.meta.url),'utf8')).items as {id:string;widthM:number;lengthM:number;heightM:number}[];
  const item=(id:string)=>catalog.find(i=>i.id===id)!;
  // asset boxes are [x length, y width, z height]
  for(const [key,id] of [['base','base'],['battery','battery'],['drive','drive'],['tray','tray'],['tablet','tablet']] as const)expect([...SERVICE_AMR_ITEMS[key]]).toEqual([item(id).lengthM,item(id).widthM,item(id).heightM]);
  expect([SERVICE_AMR_ITEMS.lidar.r*2,SERVICE_AMR_ITEMS.lidar.h]).toEqual([item('lidar').widthM,item('lidar').heightM]);
  const asset=serviceAmrAsset(defaultProject().design),c=compileAsset(asset),f=c.collision.footprint!,fp=footprintForDesign(defaultProject().design)!;
  expect(f.max[1]-f.min[1]).toBeCloseTo(fp.widthM,12);expect(f.max[0]-f.min[0]).toBeCloseTo(fp.lengthM,12);
  expect(c.collision.radiusM).toBeCloseTo(Math.hypot(0.3,0.275),12); // not the 0.46 m drawn by the old viewer
  expect(asset.geometry.filter(g=>g.frameId.startsWith('tray_'))).toHaveLength(3);
 });
 it('viewer source holds no hardcoded body radius or tray size',()=>{
  const src=readFileSync(new URL('../../src/viewer/robot.ts',import.meta.url),'utf8');
  for(const literal of ['0.46','0.465','0.79','0.56','0.68'])expect(src,literal).not.toContain(literal);
  expect(src).toContain('compileAsset');
 });
 it('rejects missing units, bad quaternions and cyclic frames explicitly',()=>{
  expect(code(()=>sourceFrame(negative.missingUnits))).toBe('UNITS_MISSING');
  expect(code(()=>compileAsset(negative.badQuaternion))).toBe('QUATERNION_NOT_NORMALIZED');
  expect(code(()=>compileAsset(negative.cyclicFrames))).toBe('FRAME_CYCLE');
 });
 it('coffee cell fixture compiles with arm kinematics declared and the cup as a separate asset',()=>{
  const by=Object.fromEntries((cell.assets as AssetRevision[]).map(a=>[a.id,compileAsset(a)]));
  expect(by['arm-puma-reference']!.capabilities).toMatchObject({kinematics:true,dynamics:false});
  expect(by['arm-puma-reference']!.frames.has('tcp')).toBe(true);
  expect(by['cup-paper-illustrative']!.collision.footprint).not.toBeNull();
  expect(assetContentHash(cell.assets[0])).toBe(cell.assets[0].contentHash);
 });
});

describe('frames and units (golden parity with source)',()=>{
 it('T_A_B golden through cell_base yaw 90 deg',()=>{
  const g=buildFrameGraph([{id:'world',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},{id:'cell_base',parentId:'world',translationM:[1,2,0.5],quaternionXyzw:[0,0,S,S]},{id:'arm_base',parentId:'cell_base',translationM:[0.3,0,0],quaternionXyzw:[0,0,0,1]}]);
  const p=transformPose('arm_base','world',{position:[1,0,0],quaternionXyzw:[0,0,0,1]},g);
  near(p.position,[1,3.3,0.5]);near(p.quaternionXyzw,[0,0,S,S]);
  expect(code(()=>transformPose('arm_base','nope',p,g))).toBe('FRAME_UNKNOWN');
 });
 it('inverse roundtrip error < 1e-9 on synthetic double fixtures',()=>{
  const r=rng(11);let worst=0;
  for(let n=0;n<200;n++){
   const unit=()=>{const q=[r()-.5,r()-.5,r()-.5,r()-.5],m=Math.hypot(...q);return q.map(v=>v/m);};
   const frames:FrameDef[]=[{id:'f0',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}];
   for(let i=1;i<=6;i++)frames.push({id:`f${i}`,parentId:`f${i-1}`,translationM:[(r()-.5)*40,(r()-.5)*40,(r()-.5)*40],quaternionXyzw:unit()});
   const g=buildFrameGraph(frames),pose:Pose={position:[r()*10,r()*10,r()*10],quaternionXyzw:unit()};
   const b=transformPose('f2','f6',transformPose('f6','f2',pose,g),g);
   worst=Math.max(worst,...b.position.map((v,i)=>Math.abs(v-pose.position[i]!)),Math.min(Math.hypot(...b.quaternionXyzw.map((v,i)=>v-pose.quaternionXyzw[i]!)),Math.hypot(...b.quaternionXyzw.map((v,i)=>v+pose.quaternionXyzw[i]!))));
  }
  expect(worst).toBeLessThan(1e-9);
 });
 it('sample inch->m and deg->rad',()=>{
  const f=sourceFrame({id:'a',parentId:null,translation:[10,0,0],lengthUnit:'inch',yaw:90,angleUnit:'deg'});
  near(f.translationM,[0.254,0,0],1e-15);near(f.quaternionXyzw,quaternionFromYaw(Math.PI/2),1e-15);
 });
});

describe('hash parity',()=>{
 it('pure sha256 equals node:crypto for padding-boundary lengths',()=>{
  for(const n of [0,1,3,55,56,57,63,64,65,119,120,1000]){const b=new Uint8Array(n).map((_,i)=>(i*31+7)&255);expect(sha256Hex(b)).toBe(createHash('sha256').update(b).digest('hex'));}
  expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
 });
 it('canonical JSON sorts keys, drops undefined members and keeps ES number text',()=>{
  expect(canonicalJson({b:1,a:[true,null,'é',1e21,0.1,-0],c:undefined})).toBe('{"a":[true,null,"é",1e+21,0.1,0],"b":1}');
  expect(()=>canonicalJson({a:NaN})).toThrow();expect(hashJson({a:1,b:2})).toBe(hashJson({b:2,a:1}));
 });
});

describe('validateProjectV2',()=>{
 it('rejects unknown members, endpoints and bad shapes',()=>{
  const p=restaurant.project;
  expect(()=>validateProjectV2({...p,endpoint:'http://x'})).toThrow(/INVALID_PROJECT/);
  expect(()=>validateProjectV2({...p,schemaVersion:1})).toThrow();
  expect(()=>validateProjectV2({...p,entities:[{...p.entities[0],assetRef:{...p.entities[0].assetRef,contentHash:'xyz'}}]})).toThrow();
  expect(()=>validateProjectV2({...p,world:{...p.world,handoffPoints:[{id:'a',name:'a',kind:'table',position:[1,2],yawRad:null}]}})).toThrow();
  expect(()=>validateProjectV2({...p,world:{...p.world,points:[{id:'bad id',name:'x',kind:'table',x:1,y:1}]}})).toThrow();
 });
});

describe('IndexedDB v1 -> v2 upgrade',()=>{
 it('backs up the original v1 JSON, stores v2 and assets, and keeps the v1 reader working',async()=>{
  const store=fresh(),p=v1.service;await store.save(p);
  const result=await store.upgradeToV2(p.id);
  expect((await store.loadLegacy(p.id))!.project).toEqual(p);
  expect(await store.load(p.id)).toEqual(p);
  expect(await store.loadV2(p.id)).toEqual(result.projectV2);
  const assets=await store.loadAssets(result.projectV2);expect(assets).toEqual(result.assets);expect(assets.every(verifyAssetHash)).toBe(true);
  expect(validateProject(await store.load(p.id))).toEqual(p);
 });
 it('an interruption mid-transaction leaves no half-save: backup, v2 and the readable v1 are as before',async()=>{
  const store=fresh(),p=v1.service;await store.save(p);
  // Backup and v2 addition are queued; the asset write fails and aborts all three stores.
  const real=IDBObjectStore.prototype.put;let calls=0;
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...a:Parameters<IDBObjectStore['put']>){if(++calls===2)throw new DOMException('Storage is full','QuotaExceededError');return real.apply(this,a);});
  await expect(store.upgradeToV2(p.id)).rejects.toThrow(/Storage is full/);
  vi.restoreAllMocks();
  expect(await store.load(p.id)).toEqual(p);expect(await store.loadLegacy(p.id)).toBeNull();expect(await store.loadV2(p.id)).toBeNull();
  // Retry succeeds; a later re-upgrade is explicitly refused and keeps the first backup and stored v2 untouched.
  const ok=await store.upgradeToV2(p.id),backup=await store.loadLegacy(p.id);
  await store.save({...p,revision:2,name:'edited'});
  vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...a:Parameters<IDBObjectStore['put']>){if(a[0]&&(a[0] as {schemaVersion?:number}).schemaVersion===2)throw new DOMException('Disk error','DataError');return real.apply(this,a);});
  await expect(store.upgradeToV2(p.id)).rejects.toThrow('PROJECT_V2_EXISTS');
  vi.restoreAllMocks();
  expect(await store.loadLegacy(p.id)).toEqual(backup);expect(await store.loadV2(p.id)).toEqual(ok.projectV2);expect((await store.load(p.id))?.revision).toBe(2);
 });
 it('validation failure writes nothing and clears cleanly',async()=>{
  const store=fresh(),bad=negative.v1BadId as LabProject;await store.save(bad);
  await expect(store.upgradeToV2(bad.id)).rejects.toThrow(/MIGRATION_ID_INVALID/);
  expect(await store.loadLegacy(bad.id)).toBeNull();expect(await store.loadV2(bad.id)).toBeNull();expect(await store.load(bad.id)).toEqual(bad);
  await expect(store.upgradeToV2('missing')).rejects.toThrow(/PROJECT_NOT_FOUND/);
 });
 it('a blocked DB upgrade rejects, keeps v1 data intact and recovers once the blocker closes',async()=>{
  const name=`blocked-${crypto.randomUUID()}`,p=defaultProject();
  const old=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name,1);r.onupgradeneeded=()=>{r.result.createObjectStore('projects',{keyPath:'id'}).put(p);};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const store=fresh(name);
  await expect(store.load(p.id)).rejects.toThrow('DATABASE_UPGRADE_BLOCKED');
  old.close();
  expect(await store.load(p.id)).toEqual(p);
  // an upgraded database still reads the v1 record and exposes the new stores
  expect((await store.upgradeToV2(p.id)).projectV2.id).toBe(p.id);expect(await store.load(p.id)).toEqual(p);
 });
});

it('repeat migration refuses to overwrite an edited v2 project',async()=>{
 const name=`repeat-${crypto.randomUUID()}`,store=fresh(name),p=v1.service;await store.save(p);const migrated=await store.upgradeToV2(p.id),edited={...migrated.projectV2,name:'edited v2',revision:9};
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open(name);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 await new Promise<void>((resolve,reject)=>{const tx=db.transaction('projectsV2','readwrite');tx.objectStore('projectsV2').put(edited);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();
 await expect(store.upgradeToV2(p.id)).rejects.toThrow('PROJECT_V2_EXISTS');expect(await store.loadV2(p.id)).toEqual(edited);
});
it('a synchronous IndexedDB open failure can be retried on the same store',async()=>{
 const store=fresh();vi.spyOn(indexedDB,'open').mockImplementationOnce(()=>{throw new DOMException('Temporarily unavailable','InvalidStateError');});
 await expect(store.load('missing')).rejects.toThrow('Temporarily unavailable');expect(await store.load('missing')).toBeNull();
});
