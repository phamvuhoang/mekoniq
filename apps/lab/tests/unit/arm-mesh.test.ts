// U05 (D51, SX-57): the xArm 6 of the 3D twin drawn from its vendor meshes. The mesh chain's flange is the flange computed from the component's joint
// origins (flangeChainM, not the D-H table); the fingers follow the measured opening only; a missing or altered blob is ARM_MESH_UNAVAILABLE.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import component from '../../fixtures/engineering/xarm6-g2-v1/component.json' with {type:'json'};
import physics from '../../fixtures/engineering/xarm6-g2-v1/physics.json' with {type:'json'};
import golden from '../../fixtures/engineering/xarm6-g2-v1/fk-golden.json' with {type:'json'};
import {armJoints,gripperDriveRad,loadArmMeshes,meshFlange,poseArmMeshes} from '../../src/viewer/arm-mesh';
import {armFrames} from '../../src/twin/arm/arm-frames';
import {armModelFor} from '../../src/twin/arm/arm-telemetry';
const blobDir=new URL('../../public/fixtures/xarm6-g2-v1/blobs/',import.meta.url);
const fromDisk=async(sha:string)=>{const b=await readFile(new URL(`${sha}.stl`,blobDir));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) as ArrayBuffer;};
const load=(blob=fromDisk)=>loadArmMeshes(component,physics,blob,new THREE.MeshBasicMaterial());
const joints=armJoints(component,physics);
/** A finger's angle about its own axis, from its pivot's rotation relative to the joint origin. */
const angle=(o:THREE.Object3D)=>{const q=(o.userData.q0 as THREE.Quaternion).clone().invert().multiply(o.quaternion),a=o.userData.axis as THREE.Vector3;return 2*Math.atan2(new THREE.Vector3(q.x,q.y,q.z).dot(a),q.w);};
const world=(o:THREE.Object3D)=>{o.updateWorldMatrix(true,false);return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);};

test('at every golden pose the mesh flange is flangeChainM (≤ 1e-6 m): the component\'s joint chain, not the D-H table',async()=>{
 const set=await load();let worst=0;
 expect(golden.poses.length).toBeGreaterThan(0);
 for(const p of golden.poses){poseArmMeshes(set,armFrames(joints,p.q),null);meshFlange(set).forEach((v,k)=>{worst=Math.max(worst,Math.abs(v-p.flangeChainM[k]!));});}
 console.log(`mesh flange vs flangeChainM: largest difference ${worst.toExponential(3)} m over ${golden.poses.length} poses`);
 expect(worst).toBeLessThanOrEqual(1e-6);
});
test('fourteen mesh links (seven arm links, seven gripper links) and six finger joints driven by the gripper\'s drive joint',async()=>{
 const set=await load();
 expect(set.links).toHaveLength(component.links.length);expect(set.links).toHaveLength(14);
 expect(set.fingers.map(f=>f.object.name)).toEqual(['joint:drive_joint',...physics.gripper.mimic.map(m=>`joint:${m.joint}`)]);
 expect(joints).toHaveLength(6);
});
test('opening 0 and openingMaxM: two different finger positions, each finger at its multiplier times the drive angle; null: open',async()=>{
 const set=await load(),q=golden.poses[0]!.q,f=armFrames(joints,q),tip=set.links.find(l=>l.name==='link:left_finger')!;
 const at=(o:number|null)=>{poseArmMeshes(set,f,o);return {a:set.fingers.map(x=>angle(x.object)),p:world(tip)};};
 const closed=at(0),open=at(physics.gripper.openingMaxM),unknown=at(null);
 expect(gripperDriveRad(physics,0)).toBeCloseTo(physics.gripper.closedRad,12);expect(gripperDriveRad(physics,physics.gripper.openingMaxM)).toBe(0);expect(gripperDriveRad(physics,null)).toBe(0);
 set.fingers.forEach((x,i)=>{expect(closed.a[i]).toBeCloseTo(x.multiplier*physics.gripper.closedRad,9);expect(open.a[i]).toBeCloseTo(0,9);});
 expect(closed.p.distanceTo(open.p)).toBeGreaterThan(0.005);
 expect(unknown.a).toEqual(open.a);expect(unknown.p.distanceTo(open.p)).toBeLessThan(1e-12);
 // the flange does not move with the fingers
 poseArmMeshes(set,f,0);const a=meshFlange(set);poseArmMeshes(set,f,null);expect(meshFlange(set)).toEqual(a);
});
test('a blob whose bytes differ from its name, or one that cannot be fetched: ARM_MESH_UNAVAILABLE:<sha256>',async()=>{
 const bad=component.links[3]!.visual[0]!.geometry.blobSha256;
 await expect(load(async sha=>{const b=await fromDisk(sha);if(sha===bad)new Uint8Array(b)[200]^=1;return b;})).rejects.toThrow(`ARM_MESH_UNAVAILABLE:${bad}`);
 await expect(load(async sha=>{if(sha===bad)throw new Error('HTTP 404');return fromDisk(sha);})).rejects.toThrow(`ARM_MESH_UNAVAILABLE:${bad}`);
});
test('armModelFor: the MuJoCo plant is the xArm fixture; Webots and the mock keep the reference arm',()=>{
 expect(armModelFor('webots_arm')).toBe('arm-ref-3d-v1');expect(armModelFor('mock_arm')).toBe('arm-ref-3d-v1');expect(armModelFor('mujoco_arm')).toBe('xarm6-g2-v1');
});

// Where cups are drawn and which arm drawing is used: pure rules of scene.ts, twin3d.ts and live-playback.ts.
import project from '../../fixtures/engineering/xarm6-g2-v1/coffee-cell-project.json' with {type:'json'};
import manifest from '../../fixtures/engineering/xarm6-g2-v1/manifest.json' with {type:'json'};
import {sceneEntities,type TwinFrame,type ViewState} from '../../src/twin/scene';
import {armMeshIssues,posesOf,structureKey} from '../../src/viewer/twin3d';
import {LivePlayback} from '../../src/twin/live-playback';
import {presets} from '../../src/scenarios/catalog';
import {defaultLayers} from '../../src/twin/overlays';
import type {Held} from '../../src/twin/store';
const S=1_000_000_000;
const held=(entityId:string,o:{provider?:string;sim?:number;at?:number;observed:Record<string,unknown>;frame?:string}):Held=>({schemaVersion:2,runId:'r',entityId,providerId:o.provider??'mujoco_arm',bootId:'b',seq:String(o.sim??S),simTimeNs:String(o.sim??S),observedAt:null,receivedMonotonicNs:'0',
 frameId:o.frame??'map',origin:'physics_sim',quality:'valid',reasonCodes:[],commanded:null,observed:o.observed,estimated:null,causationId:null,receivedAtMs:o.at??1000,epochResetAtMs:null});
const armS=(o:{provider?:string;sim?:number;opening?:number}={})=>held('arm-1',{provider:o.provider,sim:o.sim,frame:'arm_base',observed:{jointsRad:[0,-1,-0.3,-3.1,0.1,0],...o.opening===undefined?{}:{gripperOpeningM:o.opening}}});
const cupS=(o:{provider?:string;sim?:number;at?:number;p?:[number,number,number]}={})=>held('cup-1',{provider:o.provider,sim:o.sim,at:o.at,observed:{positionM:o.p??[3.14,0.65,0.85],quaternionXyzw:[0,0,0,1],restingOn:'gripper',ownerKind:'arm',ownerId:'arm-1'}});
const xframe=(samples:Held[],o:{runRevision?:string}={}):TwinFrame=>({preset:{...presets.find(p=>p.id==='coffee')!,project:project as never},nowMs:1000,samples:Object.fromEntries(samples.map(s=>[s.entityId,s])),
 report:o.runRevision?{coffee:{armTrace:{modelRevision:o.runRevision}}} as never:null,
 view:{entities:[],coffee:{jobs:[],cups:[{cupId:'cup-1',ownerKind:'arm',ownerId:'arm-1'}]}} as never});
const vs:ViewState={view:'3d',layers:defaultLayers(),selected:null};
const cups=(f:TwinFrame)=>sceneEntities(f).filter(e=>e.kind==='cup');

test('a cup with a current mujoco_arm sample is drawn once, at the sample\'s pose; without one, by custody as before',()=>{
 const f=xframe([armS(),cupS()]),c=cups(f);
 expect(c).toHaveLength(1);expect([c[0]!.x,c[0]!.y]).toEqual([3.14,0.65]);expect(c[0]!.plant).toEqual({positionM:[3.14,0.65,0.85],quaternionXyzw:[0,0,0,1]});
 expect(posesOf(f).cups).toEqual({'cup-1':{positionM:[3.14,0.65,0.85],quaternionXyzw:[0,0,0,1]}});
 const custody=cups(xframe([armS()]));expect(custody).toHaveLength(1);expect(custody[0]!.plant).toBeUndefined();expect([custody[0]!.x,custody[0]!.y]).toEqual([3,1.4]);
 // another provider's or another frame's cup sample is not the plant's pose
 expect(cups(xframe([armS(),cupS({provider:'webots_arm'})]))[0]!.plant).toBeUndefined();
 expect(cups(xframe([armS(),{...cupS(),frameId:'arm_base'}]))[0]!.plant).toBeUndefined();
});
test('a cup whose samples stopped (the plant reports newer samples without it) goes back to the custody drawing',()=>{
 const f=xframe([armS({sim:5*S}),cupS({sim:3*S})]);
 expect(cups(f)[0]!.plant).toBeUndefined();expect(posesOf(f).cups).toEqual({});
 expect(cups(xframe([armS({sim:5*S}),cupS({sim:5*S-S/10})]))[0]!.plant).toBeDefined();// within the same publication window
});
test('the arm model follows the provider; a fixture revision that differs from the run\'s model revision is a notice naming both',()=>{
 const mj=xframe([armS({opening:0.05})]),wb=xframe([armS({provider:'webots_arm'})]);
 expect(structureKey(mj,vs)).not.toBe(structureKey(wb,vs));
 expect(posesOf(mj).arms['arm-1']!.gripperOpeningM).toBe(0.05);
 expect(armMeshIssues(mj)).toEqual([]);expect(armMeshIssues(wb)).toEqual([]);
 expect(armMeshIssues(xframe([armS()],{runRevision:manifest.modelRevision}))).toEqual([]);
 const other='f'.repeat(64),i=armMeshIssues(xframe([armS()],{runRevision:other}));
 expect(i).toEqual([{entityId:'arm-1',code:'ARM_MODEL_REVISION_MISMATCH',lab:manifest.modelRevision,run:other}]);
 expect(structureKey(xframe([armS()],{runRevision:other}),vs)).not.toBe(structureKey(mj,vs));
});
test('live playback: the measured opening and a cup pose are interpolated between received samples, never past the newest',()=>{
 const p=new LivePlayback({reducedMotion:()=>false,fresh:()=>true});
 for(const [i,o] of [[0,0.08],[1,0.04],[2,0]] as const){p.feed({...armS({sim:(i+1)*S/10,opening:o}),receivedAtMs:i*100},false);p.feed(cupS({sim:(i+1)*S/10,at:i*100,p:[3+i/10,0.65,0.85]}),false);}
 const f=xframe([armS({opening:0}),cupS({p:[3.2,0.65,0.85]})]),ex=posesOf(f),at=(t:number)=>p.poses(ex,t);
 expect(at(300).arms['arm-1']!.gripperOpeningM).toBeCloseTo(0.02,9);expect(at(300).cups!['cup-1']!.positionM[0]).toBeCloseTo(3.15,9);
 for(const t of [400,1000,5000]){expect(at(t).arms['arm-1']!.gripperOpeningM).toBe(0);expect(at(t).cups!['cup-1']!.positionM[0]).toBeCloseTo(3.2,12);}
 // a cup drawn by custody in the exact poses is never moved by an old buffer
 expect(p.poses({...ex,cups:{}},300).cups).toEqual({});
});

// Fix round 1: the blobs are hashed by crypto.subtle (the pure-JS hash is the fallback); a clone's finger pivots turn with the opening, by any multiplier;
// a plant cup the view does not list is counted, not silently dropped.
import {cloneArmMeshes} from '../../src/viewer/arm-mesh';
import {droppedPlantCups} from '../../src/twin/scene';
test('blobs are hashed with crypto.subtle; without it the pure-JS hash still refuses an altered blob',async()=>{
 const spy=vi.spyOn(crypto.subtle,'digest');await load();expect(spy.mock.calls.length).toBeGreaterThanOrEqual(14);// one per blob (Node's digest may re-enter itself)
 spy.mockRestore();
 vi.stubGlobal('crypto',undefined);
 try{const bad=component.links[0]!.visual[0]!.geometry.blobSha256;await expect(load(async sha=>{const b=await fromDisk(sha);if(sha===bad)new Uint8Array(b)[90]^=1;return b;})).rejects.toThrow(`ARM_MESH_UNAVAILABLE:${bad}`);}
 finally{vi.unstubAllGlobals();}
});
test('item 5: a failure says why: the fetch (worth another try), the sha256, or the parse',async()=>{
 const bad=component.links[0]!.visual[0]!.geometry.blobSha256;
 await expect(load(async sha=>{if(sha===bad)throw new TypeError('Failed to fetch');return fromDisk(sha);})).rejects.toMatchObject({reason:'fetch'});
 await expect(load(async sha=>{const b=await fromDisk(sha);if(sha===bad)new Uint8Array(b)[90]^=1;return b;})).rejects.toMatchObject({reason:'hash'});
});
test('a clone\'s finger pivots follow the opening by their own multipliers (a synthetic gripper with multipliers other than 1); the original is untouched',async()=>{
 const g=physics.gripper,synthetic={...physics,gripper:{...g,mimic:g.mimic.map((m,i)=>({...m,multiplier:[1,-0.5,2,0.25,-1][i]!}))}};
 const set=await loadArmMeshes(component,synthetic,fromDisk,new THREE.MeshBasicMaterial()),clone=cloneArmMeshes(set,new THREE.MeshBasicMaterial()),f=armFrames(joints,golden.poses[1]!.q);
 expect(clone.fingers.map(x=>x.multiplier)).toEqual([1,1,-0.5,2,0.25,-1]);
 poseArmMeshes(set,f,null);const before=set.fingers.map(x=>angle(x.object));
 for(const opening of [0,0.03,g.openingMaxM]){
  poseArmMeshes(clone,f,opening);const drive=gripperDriveRad(synthetic,opening);
  clone.fingers.forEach((x,i)=>expect(angle(x.object)).toBeCloseTo(x.multiplier*drive,9));
  expect(clone.fingers.every(x=>x.object!==set.fingers.find(y=>y.object.name===x.object.name)!.object)).toBe(true);
 }
 expect(set.fingers.map(x=>angle(x.object))).toEqual(before);
});
test('a current plant cup that the view\'s cup list does not have is counted',()=>{
 const extra=held('cup-9',{observed:{positionM:[3,0.7,0.9],quaternionXyzw:[0,0,0,1],restingOn:'stand'}});
 expect(droppedPlantCups(xframe([armS(),cupS()]))).toEqual([]);
 expect(droppedPlantCups(xframe([armS(),cupS(),extra]))).toEqual(['cup-9']);
 expect(droppedPlantCups(xframe([armS({sim:5*S}),cupS({sim:5*S}),{...extra,simTimeNs:String(2*S)}]))).toEqual([]);// stopped: not the plant's word any more
});
