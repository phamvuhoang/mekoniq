import {loadedReport} from '../support/belief-display';
import {expect,test} from 'vitest';
import {mapExtent,worldEntities} from '../../src/twin/world-view';
import {knownWorldDrawing,cellPreset} from '../../src/twin/cell';
import scene from '../../public/replays/coffee-delivery/bundle/lab-world-scene.json';
import type {LabWorldSceneV1} from '../../src/shared/navigation2d';
import {renderTwin,type TwinFrame} from '../../src/twin/scene';
import {defaultLayers} from '../../src/twin/overlays';
test('signed world extent stays in physical map coordinates in the 2D view',()=>{
 const drawing=knownWorldDrawing(scene as unknown as LabWorldSceneV1)!;const world={...drawing,record:{snapshot:{runId:'run',tick:7,robots:[{robotId:'amr-1',poseDriveMap:[-.3,-.2,0],pose3d:{z:.09,roll:.1,pitch:.2}}],props:[{propId:'cup-1',position:[.49,0,.15],quaternionXyzw:[0,0,0,1]}]}}} as unknown as NonNullable<TwinFrame['world']>;
 const frame={preset:cellPreset(),view:null,report:null,world} as TwinFrame;
 expect(mapExtent(frame)).toEqual({minM:[-.6,-.6],maxM:[6,4]});expect(worldEntities(world)[0]).toMatchObject({x:-.3,y:-.2});
 const svg=renderTwin(frame,{view:'2d',selected:null,layers:defaultLayers()});expect(svg).toContain('viewBox="-90 -30 720 520"');expect(svg).toContain('translate(-30.0,420.0)');
});
test('unknown live model never borrows the current local physical model',()=>{const changed=structuredClone(scene);changed.models.mobilePhysical.sha256='0'.repeat(64);expect(knownWorldDrawing(changed as unknown as LabWorldSceneV1)).toBe(null);});

test('a world with no admitted extent refuses display instead of borrowing zero-origin bounds',()=>{
 const changed=structuredClone(scene) as unknown as LabWorldSceneV1;delete changed.controllerPolicy;const frame={preset:cellPreset(),view:null,report:null,world:{scene:changed}} as unknown as TwinFrame;expect(()=>mapExtent(frame)).toThrow('WORLD_DISPLAY_EXTENT_UNAVAILABLE');
});

test('the 2D plan draws the belief dashed against the truth dot at the cursor, and nothing when the report has no perception stream',()=>{
 const drawing=knownWorldDrawing(scene as unknown as LabWorldSceneV1)!,world={...drawing,record:{snapshot:{runId:'run',tick:20,robots:[{robotId:'amr-1',poseDriveMap:[.35,.49,0]}],props:[]}}} as never;
 const rec=(tick:number)=>({tick,objectId:'cup-1',dropped:false,errorM:0.007,truthAtObservedTick:[0.49,0,0.15],belief:{objectId:'cup-1',kind:'cup',frameId:'arm-base',positionM:[0.497,0,0.15],sigmaM:[0.002,0.002,0],observedTick:tick-5,publishedTick:tick,ageTicks:0,source:'pose_estimator_sim',valid:true}});
 const vs={view:'2d' as const,selected:null,layers:{...defaultLayers(),footprint:false}},base={preset:cellPreset(),view:{tick:20,entities:[]},world} as never as TwinFrame;
 const with_=renderTwin({...base,report:loadedReport([rec(10),rec(20)] as never)} as never,vs);
 expect(with_).toContain('data-belief="cup-1"');expect(with_).toContain('data-error-mm="7.00"');expect(with_).toContain('tw-belief-ghost');
 expect(renderTwin({...base,report:{}} as never,vs)).not.toContain('tw-belief');
 expect(renderTwin({...base,report:{perceptionEvidence:{schemaVersion:1,beliefs:[rec(30)],attempts:[],recovery:[],complete:true,issues:[]}}} as never,vs)).not.toContain('tw-belief'); // nothing believed yet at the cursor
});
