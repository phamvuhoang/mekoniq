// D65: the 3D view keeps its scene; a change of the scene (project, navigation scene, layers, selection) rebuilds it, a change of one object's drawing (the set of
// objects, a source, the arm's display source) redraws that object (sceneKey, objectKeys; structureKey covers both). A new pose or joint angle never does either.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {anchoredOverlays,homeRegion,objectKeys,posesOf,sceneKey,structureKey} from '../../src/viewer/twin3d';
import type {TwinFrame,ViewState} from '../../src/twin/scene';
import {defaultLayers} from '../../src/twin/overlays';
import {presets} from '../../src/scenarios/catalog';
import type {Held} from '../../src/twin/store';
import layout from '../../fixtures/engineering/xarm6-g2-v1/cell-layout.json' with {type:'json'};

const arm=(joints:number[]|null,seq=1):Held=>({schemaVersion:2,runId:'r',entityId:'arm-1',providerId:'mock_arm',bootId:'b',seq:String(seq),simTimeNs:String(seq*1e8),observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'mock',quality:'valid',reasonCodes:[],
 commanded:null,observed:joints?{jointsRad:joints}:{},estimated:null,causationId:null,receivedAtMs:1000,epochResetAtMs:null});
const frame=(o:{x?:number;joints?:number[]|null;cups?:number}={}):TwinFrame=>({preset:presets.find(p=>p.id==='coffee')!,report:null,nowMs:1000,samples:{'arm-1':arm(o.joints===undefined?[0,-0.6,1.2,0,0.6,0]:o.joints)},
 view:{entities:[{id:'amr-1',kind:'amr',pose:{x:o.x??1,y:1,yawRad:0.2},quality:'valid',moving:true,hold:null,goal:null,path:[],distanceM:0}],coffee:o.cups?{jobs:[],cups:Array.from({length:o.cups},(_,i)=>({cupId:`cup-${i}`,ownerKind:'cell',ownerId:'coffee-1'}))}:null} as never});
const vs:ViewState={view:'3d',layers:defaultLayers(),selected:null};

test('only poses changed: same key',()=>{
 expect(structureKey(frame({x:1}),vs)).toBe(structureKey(frame({x:2.5,joints:[0.3,-0.2,1,0.1,0.5,0.2]}),vs));
});
test('a layer, the selection, a new object or the arm going from observed to unknown: a new key',()=>{
 const k=structureKey(frame(),vs);
 expect(structureKey(frame(),{...vs,layers:{...vs.layers,frames:true}})).not.toBe(k);
 expect(structureKey(frame(),{...vs,selected:'amr-1'})).not.toBe(k);
 expect(structureKey(frame({cups:1}),vs)).not.toBe(k);
 expect(structureKey(frame({joints:null}),vs)).not.toBe(k);
});
test('posesOf: the AMR base in the ROS map and the arm joints shown, from the frame',()=>{
 const p=posesOf(frame({x:2}));
 expect(p.bodies['amr-1']!.positionM).toEqual([2,1,0]);
 expect(p.bodies['amr-1']!.quaternionXyzw[2]).toBeCloseTo(Math.sin(0.1),12);
 expect(p.arms['arm-1']).toEqual({jointsRad:[0,-0.6,1.2,0,0.6,0],gripperOpeningM:null});
 expect(posesOf(frame({joints:null})).arms).toEqual({});
});
test('a footprint is drawn in its body frame: the same outline whatever the pose (it moves with the body, it is not rebuilt)',()=>{
 const fp=(x:number)=>{const f=frame({x});f.view!.entities[0]!.pose.yawRad=x;return anchoredOverlays(f,vs).filter(s=>s.layer==='footprint');};
 const a=fp(1),b=fp(2.5);expect(a).toHaveLength(1);expect(a[0]!.anchored).toBe(true);
 a[0]!.points.forEach((p,i)=>p.forEach((v,k)=>expect(v).toBeCloseTo(b[0]!.points[i]![k]!,9)));
});
test('sceneKey: a layer or the selection rebuilds; a new object or a stale arm only changes objectKeys (that object is redrawn, the scene stays)',()=>{
 const k=sceneKey(frame(),vs),o=objectKeys(frame());
 expect(sceneKey(frame(),{...vs,layers:{...vs.layers,frames:true}})).not.toBe(k);expect(sceneKey(frame(),{...vs,selected:'amr-1'})).not.toBe(k);
 expect(sceneKey(frame({cups:1}),vs)).toBe(k);expect(sceneKey(frame({joints:null}),vs)).toBe(k);expect(sceneKey(frame({x:3}),vs)).toBe(k);
 expect(objectKeys(frame({cups:1})).has('cup-0')).toBe(true);expect(objectKeys(frame({joints:null})).get('arm-1')).not.toBe(o.get('arm-1'));
 expect([...objectKeys(frame({x:3,joints:[0.3,-0.2,1,0.1,0.5,0.2]}))]).toEqual([...o]);
});
test('U06 fix 1: the arm-cell preset opens on the cell: boxes derived from the scene (the arm over its base; the docked robot at each coffee pickup); other presets frame the floor',()=>{
 const mj=presets.find(p=>p.id==='mujoco-coffee')!,base=mj.project.armCollisionProfile!.baseInMap.position,pick=mj.project.world.points.find(p=>p.kind==='coffee_pickup')!;
 const boxes=homeRegion({preset:mj,report:null,view:null} as unknown as TwinFrame)!;
 expect(boxes).toHaveLength(4);// the arm, the nozzle stand, the tray, the docked robot
 const E=1e-9,has=(x:number,y:number,z:number)=>boxes.some(b=>x>=b.min[0]-E&&x<=b.max[0]+E&&y>=b.min[1]-E&&y<=b.max[1]+E&&z>=b.min[2]-E&&z<=b.max[2]+E);// a corner on a box's face, to rounding
 expect(has(base[0]!,base[1]!,base[2]!+0.7),'the arm standing up over its base').toBe(true);
 for(const [dx,dy] of [[-0.4,-0.4],[0.4,0.4],[-0.4,0.4],[0.4,-0.4]])expect(has(pick.x+dx,pick.y+dy,0),'the docked robot on the floor').toBe(true);
 expect(has(pick.x,pick.y,0.45)).toBe(true);
 // the supports of the cell layout, placed through baseInMap: every corner of the stand and the tray is inside the region
 for(const sp of [layout.nozzleStand,layout.tray])for(let i=0;i<8;i++)expect(has(...[0,1,2].map(k=>base[k]!+sp.centerM[k]!+(i>>k&1?1:-1)*sp.sizeM[k]!/2) as [number,number,number]),`support corner ${i}`).toBe(true);
 for(const b of boxes)expect(b.max[0]-b.min[0]).toBeLessThan(mj.project.world.width/2);// a cell, not the floor
 expect(homeRegion({preset:presets.find(p=>p.id==='coffee')!,report:null,view:null} as unknown as TwinFrame)).toBeNull();
});
