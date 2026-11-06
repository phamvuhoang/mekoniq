import {expect,test} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateProjectV2,validateAssetRevision,type AssetRevision} from '../../packages/lab-runtime/src/v2/contracts';
import {buildFrameGraph,transformPose,sourceFrame,lengthToM,angleToRad,quaternionFromYaw,type FrameDef,type Pose} from '../../packages/lab-runtime/src/v2/frames';
import {compileAsset,assetContentHash,verifyAssetHash,sealAsset,worldHash} from '../../packages/lab-runtime/src/v2/assets';
import {migrateV1Project,type LabProjectV1} from '../../packages/lab-runtime/src/v2/project-migration';

const rng=(seed:number)=>()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
const S=Math.SQRT1_2;
const v1Restaurant:LabProjectV1={schemaVersion:1,id:'lab-1',name:'Restaurant',revision:3,updatedAt:'2026-11-01T00:00:00Z',
 design:{id:'service-robot',revision:2,chassis:'service',trays:3,batteryAh:20,sensor:'lidar',payloadKg:10},
 world:{id:'world-1',revision:4,width:12,height:8,points:[{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:2},{id:'table-1',name:'T01',kind:'table',x:3,y:1.1}],obstacles:[{id:'f1',x:2.4,y:1.55,width:1.2,height:0.9}]}};
const v1Valetudo:LabProjectV1={...v1Restaurant,design:{...v1Restaurant.design,chassis:'valetudo',batteryAh:20,sensor:'lidar'}};
const code=(fn:()=>unknown)=>{try{fn();}catch(e){return (e as {code?:string}).code??(e as Error).message;}return 'NO_THROW';};
const near=(a:readonly number[],b:readonly number[],tol=1e-9)=>{expect(a.length).toBe(b.length);a.forEach((v,i)=>expect(Math.abs(v-b[i]!)).toBeLessThanOrEqual(tol));};

test('transform convention T_A_B: golden world pose through cell_base yaw 90 deg and arm_base offset',()=>{
 const g=buildFrameGraph([{id:'world',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},{id:'cell_base',parentId:'world',translationM:[1,2,0.5],quaternionXyzw:[0,0,S,S]},{id:'arm_base',parentId:'cell_base',translationM:[0.3,0,0],quaternionXyzw:[0,0,0,1]}]);
 const p=transformPose('arm_base','world',{position:[1,0,0],quaternionXyzw:[0,0,0,1]},g);
 near(p.position,[1,3.3,0.5]);near(p.quaternionXyzw,[0,0,S,S]);
 near(transformPose('world','world',p,g).position,p.position,0);
});

test('frame inverse roundtrip error stays below 1e-9 on synthetic double fixtures',()=>{
 const r=rng(11);let worst=0;
 for(let n=0;n<200;n++){
  const frames:FrameDef[]=[{id:'f0',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}];
  for(let i=1;i<=6;i++){const q=[r()-.5,r()-.5,r()-.5,r()-.5],m=Math.hypot(...q);frames.push({id:`f${i}`,parentId:`f${i-1}`,translationM:[(r()-.5)*40,(r()-.5)*40,(r()-.5)*40],quaternionXyzw:q.map(v=>v/m) as [number,number,number,number]});}
  const g=buildFrameGraph(frames),q=[r()-.5,r()-.5,r()-.5,r()-.5],m=Math.hypot(...q);
  const pose:Pose={position:[r()*10,r()*10,r()*10],quaternionXyzw:q.map(v=>v/m) as [number,number,number,number]};
  const a=transformPose('f6','f2',pose,g),b=transformPose('f2','f6',a,g);
  const dq=Math.min(Math.hypot(...b.quaternionXyzw.map((v,i)=>v-pose.quaternionXyzw[i]!)),Math.hypot(...b.quaternionXyzw.map((v,i)=>v+pose.quaternionXyzw[i]!)));
  worst=Math.max(worst,dq,...b.position.map((v,i)=>Math.abs(v-pose.position[i]!)));
 }
 expect(worst).toBeLessThan(1e-9);
});

test('sample inch->m and deg->rad enter frames only through explicit units',()=>{
 expect(lengthToM(10,'inch')).toBeCloseTo(0.254,15);expect(lengthToM(250,'mm')).toBeCloseTo(0.25,15);expect(angleToRad(90,'deg')).toBeCloseTo(Math.PI/2,15);
 const f=sourceFrame({id:'a',parentId:null,translation:[10,0,0],lengthUnit:'inch',yaw:90,angleUnit:'deg'});
 near(f.translationM,[0.254,0,0],1e-15);near(f.quaternionXyzw,quaternionFromYaw(Math.PI/2),1e-15);near(f.quaternionXyzw,[0,0,S,S],1e-15);
 expect(code(()=>sourceFrame({id:'a',parentId:null,translation:[1,0,0],yaw:0} as never))).toBe('UNITS_MISSING');
 expect(code(()=>lengthToM(1,'furlong' as never))).toBe('UNITS_MISSING');
});

test('frame graph rejects unknown frames, bad quaternions, cycles and ambiguous roots',()=>{
 const id:[number,number,number,number]=[0,0,0,1];
 const ok:FrameDef[]=[{id:'w',parentId:null,translationM:[0,0,0],quaternionXyzw:id},{id:'a',parentId:'w',translationM:[1,0,0],quaternionXyzw:id}];
 const g=buildFrameGraph(ok);
 expect(code(()=>transformPose('a','nope',{position:[0,0,0],quaternionXyzw:id},g))).toBe('FRAME_UNKNOWN');
 expect(code(()=>transformPose('nope','a',{position:[0,0,0],quaternionXyzw:id},g))).toBe('FRAME_UNKNOWN');
 expect(code(()=>buildFrameGraph([ok[0]!,{...ok[1]!,quaternionXyzw:[0,0,2,0]}]))).toBe('QUATERNION_NOT_NORMALIZED');
 expect(code(()=>buildFrameGraph([ok[0]!,{...ok[1]!,quaternionXyzw:[0,0,0,0]}]))).toBe('QUATERNION_NOT_NORMALIZED');
 expect(code(()=>buildFrameGraph([ok[0]!,{...ok[1]!,translationM:[NaN,0,0]}]))).toBe('FRAME_NOT_FINITE');
 expect(code(()=>buildFrameGraph([{id:'a',parentId:'b',translationM:[0,0,0],quaternionXyzw:id},{id:'b',parentId:'a',translationM:[0,0,0],quaternionXyzw:id},{id:'w',parentId:null,translationM:[0,0,0],quaternionXyzw:id}]))).toBe('FRAME_CYCLE');
 expect(code(()=>buildFrameGraph([ok[0]!,{...ok[1]!,parentId:'ghost'}]))).toBe('FRAME_PARENT_UNKNOWN');
 expect(code(()=>buildFrameGraph([ok[0]!,ok[0]!]))).toBe('FRAME_DUPLICATE');
 expect(code(()=>buildFrameGraph([ok[0]!,{...ok[1]!,parentId:null}]))).toBe('FRAME_ROOT_COUNT');
 expect(code(()=>transformPose('a','w',{position:[0,0,0],quaternionXyzw:[0,0,3,0]},g))).toBe('QUATERNION_NOT_NORMALIZED');
});

const hash='a'.repeat(64);
const serviceBase=(over:Partial<AssetRevision>={}):AssetRevision=>sealAsset({schemaVersion:2,id:'service-amr',revision:1,contentHash:hash,hashAlgorithm:'sha256-canonical-json-v1',kind:'amr',visual:null,collision:null,
 frames:[{id:'base_link',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},{id:'chassis',parentId:'base_link',translationM:[0.1,0,0.2],quaternionXyzw:[0,0,0,1]},{id:'tray_1',parentId:'base_link',translationM:[0,0,0.5],quaternionXyzw:[0,0,0,1]}],
 geometry:[{kind:'box',frameId:'chassis',sizeM:[0.6,0.55,0.15]},{kind:'box',frameId:'tray_1',sizeM:[0.4,0.45,0.02]}],
 inertial:{massKg:30},provenance:[{parameter:'geometry',source:'illustrative'},{parameter:'inertial.massKg',source:'measured',reference:'scale'}],...over} as AssetRevision);
const unmeasuredValetudo=sealAsset({schemaVersion:2,id:'valetudo-ref',revision:1,contentHash:hash,hashAlgorithm:'sha256-canonical-json-v1',kind:'amr',visual:null,collision:null,
 frames:[{id:'base_link',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}],geometry:[],provenance:[{parameter:'geometry',source:'assumed'}]} as AssetRevision);

test('compileAsset derives visual and collision from one geometry source and reports capabilities honestly',()=>{
 const c=compileAsset(serviceBase());
 // chassis is centred at x=0.1 with 0.6 x 0.55 footprint; tray 0.4 x 0.45 sits inside.
 near(c.collision.footprint!.min,[-0.2,-0.275],1e-12);near(c.collision.footprint!.max,[0.4,0.275],1e-12);
 expect(c.visual.shapes).toEqual(c.collision.shapes);expect(c.collision.deviationM).toBe(0);
 near(c.visual.bounds!.min,c.collision.bounds!.min,0);
 near(c.collision.bounds!.max,[0.4,0.275,0.5+0.01],1e-12);
 expect(c.capabilities).toMatchObject({visual:true,collision:true,kinematics:false,dynamics:true});
 expect(c.frames.has('tray_1')).toBe(true);
 // illustrative geometry is flagged, it is never a measurement.
 expect(c.capabilities.geometryProvenance).toBe('illustrative');
});

test('unmeasured Valetudo keeps unknowns null with reasons and never gets dynamics',()=>{
 const c=compileAsset(unmeasuredValetudo);
 expect(c.capabilities.dynamics).toBe(false);expect(c.capabilities.collision).toBe(false);
 expect(c.collision.footprint).toBeNull();expect(c.collision.bounds).toBeNull();expect(c.visual.bounds).toBeNull();
 expect(c.capabilities.unknown).toEqual(expect.arrayContaining([{parameter:'inertial.massKg',reason:'NOT_PROVIDED'},{parameter:'geometry',reason:'NOT_PROVIDED'}]));
 // mass without measured/vendor provenance still does not unlock dynamics.
 expect(compileAsset(serviceBase({provenance:[{parameter:'geometry',source:'illustrative'},{parameter:'inertial.massKg',source:'assumed'}]})).capabilities.dynamics).toBe(false);
 expect(compileAsset(serviceBase({inertial:undefined})).capabilities.dynamics).toBe(false);
});

test('compileAsset rejects invalid asset models explicitly',()=>{
 expect(code(()=>compileAsset(serviceBase({geometry:[{kind:'box',frameId:'ghost',sizeM:[1,1,1]}]})))).toBe('ASSET_GEOMETRY_FRAME_UNKNOWN');
 expect(code(()=>compileAsset(serviceBase({frames:[{id:'a',parentId:'b',translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},{id:'b',parentId:'a',translationM:[0,0,0],quaternionXyzw:[0,0,0,1]},{id:'w',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}],geometry:[]})))).toBe('FRAME_CYCLE');
 expect(code(()=>compileAsset(serviceBase({frames:[{id:'w',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,5,0]}],geometry:[]})))).toBe('QUATERNION_NOT_NORMALIZED');
});

test('asset content hash seals every field except the hash and detects tampering',()=>{
 const a=serviceBase();expect(validateAssetRevision(a).ok).toBe(true);expect(verifyAssetHash(a)).toBe(true);expect(a.contentHash).toBe(assetContentHash(a));
 expect(verifyAssetHash({...a,geometry:[{kind:'box',frameId:'chassis',sizeM:[0.6,0.55,0.16]},a.geometry[1]!]})).toBe(false);
 expect(verifyAssetHash({...a,revision:2})).toBe(false);
});

test('migrateV1Project keeps handoff coordinates, backs the design into amr-1 and marks geometry illustrative',()=>{
 const input=structuredClone(v1Restaurant),result=migrateV1Project(v1Restaurant);
 expect(v1Restaurant).toEqual(input);
 expect(result.projectV2.world.handoffPoints![0]!.position).toEqual([1,2,0]);
 expect(result.projectV2.world.handoffPoints!.map(p=>p.id)).toEqual(['kitchen','table-1']);
 expect(result.projectV2.world.handoffPoints![0]!.yawRad).toBeNull();
 expect(result.projectV2.world.points).toEqual(v1Restaurant.world.points);expect(result.projectV2.world.obstacles).toEqual(v1Restaurant.world.obstacles);
 expect(result.warnings).toContain('GEOMETRY_ILLUSTRATIVE');expect(result.warnings).toContain('ASSET_SELECTION_REQUIRED_BEFORE_SIL');expect(result.warnings).toContain('HANDOFF_YAW_UNKNOWN');
 expect(result.projectV2.entities.map(e=>[e.id,e.kind])).toEqual([['amr-1','amr']]);
 expect(validateProjectV2(result.projectV2).ok).toBe(true);
 const asset=result.assets[0]!;expect(validateAssetRevision(asset).ok).toBe(true);expect(verifyAssetHash(asset)).toBe(true);
 expect(result.projectV2.entities[0]!.assetRef).toEqual({id:asset.id,revision:asset.revision,contentHash:asset.contentHash});
 // illustrative mass is not dynamics; the service footprint is the catalog 0.55 x 0.60 base, three trays, no hardcoded viewer radius.
 const c=compileAsset(asset);expect(c.capabilities.dynamics).toBe(false);near(c.collision.footprint!.min,[-0.3,-0.275],1e-12);
 expect(asset.geometry.filter(g=>g.frameId.startsWith('tray_'))).toHaveLength(3);
 expect(result.projectV2.id).toBe('lab-1');expect(result.projectV2.revision).toBe(4);
});

test('migrateV1Project: Valetudo has unknown footprint and no inertial, and invalid v1 is refused',()=>{
 const r=migrateV1Project(v1Valetudo),a=r.assets[0]!;
 expect(a.geometry).toEqual([]);expect(a.inertial).toBeUndefined();expect(r.warnings).toContain('FOOTPRINT_UNKNOWN');
 expect(compileAsset(a).capabilities.dynamics).toBe(false);expect(validateProjectV2(r.projectV2).ok).toBe(true);
 expect(code(()=>migrateV1Project({...v1Restaurant,schemaVersion:2} as never))).toBe('MIGRATION_INVALID_V1');
 expect(code(()=>migrateV1Project({...v1Restaurant,design:{...v1Restaurant.design,chassis:'robot'}} as never))).toBe('MIGRATION_INVALID_V1');
 // v1 allows any non-blank id text; v2 ids are a strict charset, so such a project is refused instead of renamed.
 expect(code(()=>migrateV1Project({...v1Restaurant,id:'has space'}))).toBe('MIGRATION_ID_INVALID');
 expect(code(()=>migrateV1Project({...v1Restaurant,world:{...v1Restaurant.world,points:[{id:'bad id',name:'x',kind:'table',x:1,y:1}]}}))).toBe('MIGRATION_ID_INVALID');
 expect(code(()=>migrateV1Project({...v1Restaurant,world:{...v1Restaurant.world,obstacles:[{id:'bad id',x:1,y:1,width:1,height:1}]}}))).toBe('MIGRATION_ID_INVALID');
 expect(code(()=>migrateV1Project({...v1Restaurant,world:{...v1Restaurant.world,points:[{id:'x',name:'x',kind:'table',x:'1',y:2}]}} as never))).toBe('MIGRATION_INVALID_V1');
});

test('world hash changes with any model change but not with the revision counter itself',()=>{
 const w=migrateV1Project(v1Restaurant).projectV2.world;
 expect(worldHash(w)).toBe(worldHash(structuredClone(w)));
 expect(worldHash({...w,revision:w.revision+1})).toBe(worldHash(w));
 expect(worldHash({...w,points:[{...w.points[0]!,x:9},...w.points.slice(1)]})).not.toBe(worldHash(w));
});

// Lab twin guard. source/ and lab/ are separate repos with separate CI, so source CI (CI=true, no lab/) must skip these.
// Set LAB_V2_REQUIRE_LAB_FIXTURES=1 (e.g. in a workspace checkout that has both) to make a missing lab/ fail loudly instead of skip.
const LAB='../lab/',labFixtures=['restaurant-v2','coffee-cell-v2','v1-legacy'].map(n=>`${LAB}fixtures/twins/${n}.json`);
const required=process.env.LAB_V2_REQUIRE_LAB_FIXTURES==='1';
const labTest=(name:string,fn:()=>void)=>test.skipIf(!required&&!labFixtures.every(f=>existsSync(f)))(name,fn);
const readLab=(f:string)=>readFileSync(LAB+f,'utf8');
labTest('Lab twin fixtures satisfy the v2 contracts, hashes and frame graphs',()=>{
 for(const f of labFixtures.slice(0,2)){
  const doc=JSON.parse(readFileSync(f,'utf8')) as {project:unknown;assets:AssetRevision[]};
  expect(validateProjectV2(doc.project).ok).toBe(true);
  for(const a of doc.assets){expect(validateAssetRevision(a).ok).toBe(true);expect(verifyAssetHash(a)).toBe(true);expect(()=>compileAsset(a)).not.toThrow();}
  const refs=(doc.project as {entities:{assetRef:{id:string;contentHash:string}}[]}).entities.map(e=>e.assetRef);
  for(const r of refs)expect(doc.assets.find(a=>a.id===r.id)?.contentHash).toBe(r.contentHash);
 }
});
labTest('source migrateV1Project on the Lab v1 fixtures equals the Lab v2 fixtures (project, assets, warnings)',()=>{
 const v1=JSON.parse(readLab('fixtures/twins/v1-legacy.json')) as {service:LabProjectV1;valetudo:LabProjectV1};
 const service=migrateV1Project(v1.service),fixture=JSON.parse(readLab('fixtures/twins/restaurant-v2.json')) as {project:unknown;assets:unknown;warnings:unknown};
 expect(service.projectV2).toEqual(fixture.project);expect(service.assets).toEqual(fixture.assets);expect(service.warnings).toEqual(fixture.warnings);
 // The coffee cell reuses the migrated AMR asset, so a changed serviceAmrAsset also breaks this fixture's hash reference.
 const cell=JSON.parse(readLab('fixtures/twins/coffee-cell-v2.json')) as {assets:AssetRevision[]};
 expect(cell.assets.find(a=>a.kind==='amr')).toEqual(service.assets[0]);
 // Valetudo has no Lab v2 fixture file; pin its migrated shape so a source change shows up here and in the Lab twin test.
 const valetudo=migrateV1Project(v1.valetudo);
 expect(valetudo.assets[0]!.geometry).toEqual([]);expect(valetudo.assets[0]!.inertial).toBeUndefined();expect(valetudo.warnings).toContain('FOOTPRINT_UNKNOWN');
});
// Header comment, imports and the Lab-only type re-exports differ by design; everything else must be byte-identical.
const body=(src:string)=>src.split('\n').slice(1).filter(l=>!/^import /.test(l)&&!/^\/\/ TODO\(interim-copy\)/.test(l)&&!/^export type \{(AssetRevision|LabProjectV1)\};$/.test(l)&&!/^export interface LabProjectV1 /.test(l)).join('\n');
const SRC='packages/lab-runtime/src/v2/';
for(const [source,lab] of [['frames.ts','src/twin/frames.ts'],['assets.ts','src/twin/model.ts'],['project-migration.ts','src/project/migrations/v1-v2.ts']] as const)
 labTest(`Lab copy ${lab} has the same code as source ${source}`,()=>{
  expect(createHash('sha256').update(body(readLab(lab))).digest('hex')).toBe(createHash('sha256').update(body(readFileSync(SRC+source,'utf8'))).digest('hex'));
  expect(readLab(lab)).toContain('TODO(interim-copy)');
 });

// v1 project shape: source `LabProjectV1` (inline) vs Lab `LabProject` + its named sub-types. Compared structurally (flattened paths, same order, same leaf types).
const flat=(src:string,name:string)=>{
 const defs=new Map<string,string>(),re=/export interface (\w+) (\{.*\})\s*$/gm;
 for(let m;(m=re.exec(src));)defs.set(m[1]!,m[2]!.replace(/\s+/g,''));
 const fields=(body:string):[string,string][]=>{const out:string[]=[];let depth=0,cur='';for(const ch of body){if('{[('.includes(ch))depth++;if('}])'.includes(ch))depth--;if(ch===';'&&depth===0){out.push(cur);cur='';}else cur+=ch;}if(cur)out.push(cur);return out.map(f=>[f.slice(0,f.indexOf(':')),f.slice(f.indexOf(':')+1)]);};
 const walk=(type:string,path:string,acc:string[])=>{let arr='';while(type.endsWith('[]')){arr+='[]';type=type.slice(0,-2);}
  const body=type.startsWith('{')?type:defs.get(type);
  if(body)for(const [n,t] of fields(body.slice(1,-1)))walk(t,`${path}${arr}.${n}`,acc);else acc.push(`${path}${arr}:${type}`);return acc;};
 return walk(name,'',[]);
};
labTest('Lab v1 project types (LabProject and sub-types) have the same structure as source LabProjectV1',()=>{
 const sourceShape=flat(readFileSync(SRC+'project-migration.ts','utf8'),'LabProjectV1'),labShape=flat(readLab('src/shared/types.ts'),'LabProject');
 expect(sourceShape.length).toBeGreaterThan(20); // guards against the parser matching nothing
 expect(labShape).toEqual(sourceShape);
});
