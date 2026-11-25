// Review7 #4: every layer toggle the twin offers in 3D draws something there, from the same frame data as the 2D plan; a layer the 3D view cannot draw is
// disabled in 3D with a visible reason, never left on while nothing is drawn.
import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};});
import {overlayShapes} from '../../src/viewer/twin3d';
import {footprintInMap} from '../../src/twin/lidar';
import {observedSegments,type TwinFrame} from '../../src/twin/scene';
import {defaultLayers,LAYERS,type Layer} from '../../src/twin/overlays';
import {THREE_D_LAYERS} from '../../src/twin/overlays';
import {presets} from '../../src/scenarios/catalog';
import type {NavigationSceneV1} from '../../src/shared/navigation2d';
import serveScene from '../../fixtures/engineering/serve-demo-v1/navigation-scene.json' with {type:'json'};

const scene=serveScene as unknown as NavigationSceneV1,pose={x:2,y:3,yawRad:0.4};
const sample=(seq:number,x:number)=>({schemaVersion:2,runId:'r',entityId:'amr-1',providerId:'irsim_2d',bootId:'b',seq:String(seq),simTimeNs:String(seq*100_000_000),observedAt:null,receivedMonotonicNs:'0',frameId:'map',origin:'controller_sim',quality:'valid',reasonCodes:[],commanded:null,observed:{xM:x,yM:3,yawRad:0,moving:true,hold:null},estimated:null,causationId:null});
const frame=():TwinFrame=>({preset:presets.find(p=>p.engineering)!,navigation:scene,
 view:{entities:[{id:'amr-1',kind:'amr',pose,quality:'valid',moving:true,hold:null,goal:null,path:[],distanceM:0}]} as never,
 report:{telemetry:{lossy:true,coalesced:true,rateHz:10,source:'irsim',samples:[sample(1,1),sample(2,1.5),sample(3,2)],sampleCounts:{},dropped:0,gaps:[]}} as never});
const only=(l:Layer)=>({view:'3d' as const,selected:null,layers:Object.fromEntries(LAYERS.map(x=>[x,x===l])) as ReturnType<typeof defaultLayers>});

test('3D draws the safety envelope and the observed path from the same data as 2D (compiled footprint + policy margin; lossy telemetry segments)',()=>{
 const f=frame();
 expect(overlayShapes(f,only('safety'))).toEqual([{layer:'safety',entityId:'amr-1',loop:true,z:expect.any(Number),points:footprintInMap(scene.robots[0]!.model,pose,scene.policy.parameters.safetyMarginM)}]);
 const observed=overlayShapes(f,only('observed'));
 expect(observed.map(s=>s.points)).toEqual(observedSegments(f,'amr-1'));expect(observed.length).toBeGreaterThan(0);
 expect(observed.every(s=>s.layer==='observed'&&!s.loop)).toBe(true);
 // nothing invented: no compiled scene, no safety envelope; no telemetry, no observed path
 expect(overlayShapes({...f,navigation:null},only('safety'))).toEqual([]);
 expect(overlayShapes({...f,report:null},only('observed'))).toEqual([]);
});
test('every layer offered as drawable in 3D draws something for this frame; the others are the declared 2D-only set',()=>{
 const f=frame(),drawsIn3d=(l:Layer)=>overlayShapes(f,only(l)).length>0||l==='frames';
 expect(LAYERS.filter(l=>THREE_D_LAYERS.includes(l)&&l!=='path').filter(l=>!drawsIn3d(l))).toEqual([]);// path: none planned in this frame (IR entities path:[])
 expect(LAYERS.filter(l=>!THREE_D_LAYERS.includes(l)).sort()).toEqual(['contacts','scan']);
});
