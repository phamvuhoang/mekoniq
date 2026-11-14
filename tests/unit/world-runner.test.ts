import {afterEach,expect,test,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createScenarioRun,type RunManifestInput} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {MockPlant} from '../../packages/lab-runtime/src/v2/backends/mock-amr';
import {createMockCoffeePorts} from '../../packages/lab-runtime/src/v2/beverage/coffee-ports';
import type {WorldPortsFactory,WorldFactoryInput} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
import type {RobotAdapter} from '../../packages/robot-adapters/src/contract';
import type {Sim3DSnapshotV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {act,cleanupRuns,runDirectory} from '../support/lab-v2';
afterEach(async()=>{vi.restoreAllMocks();await cleanupRuns();});
const fx=resolve('robotics/simulation-mujoco/fixtures/coffee-delivery-world-v1');
async function setup(failure?:'append'|'commit'|'source-write'|'direct-source-write'|'lost'|'coffee-commit'){
 const project=JSON.parse(await readFile(fx+'/project.json','utf8'));
 const manifest:RunManifestInput={project,scenarioId:'MJ-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'test-world',sourceCommit:'test'};
 const catalog:CapabilityCatalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b),sets:{...defaultCatalog.sets,'test-world':{...defaultCatalog.sets['engineering-mujoco-arm-v1']!,backends:['mujoco_3d','mujoco_arm','mock_coffee'],providers:{amr:'mujoco_3d',arm:'mujoco_arm',coffee:'mock_coffee'},execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1],composition:'single_world'}}}};
 const scene=JSON.parse(await readFile(fx+'/lab-world-scene.json','utf8'));
 const snap=(tick:number):Sim3DSnapshotV1=>({schemaVersion:1,worldStep:{workerPid:1,modelCount:1,physicsSubsteps:(tick+1)*10,primingSubsteps:10,nq:35,nv:32,nbody:30,ngeom:27},runId:'assigned',bootId:'engine-boot',seq:String(tick+1),tick,simTimeNs:String(tick*20_000_000),sceneDigest:scene.sceneDigest,robots:[{robotId:'amr-1',poseDriveMap:[.35+tick*.001,.48591366218667575,Math.PI/2],bodyVelocity:[.05,0],collisionIds:[],scans:[],pose3d:{z:.09,roll:0,pitch:0},wheels:{leftRadS:0,rightRadS:0}}],arms:[{armId:'arm-1',positionsRad:scene.armCell.arm.homeRad,velocitiesRadS:[0,0,0,0,0,0],collisionIds:[],gripper:{openingM:.0889,heldPropIds:[]}}],props:[]});
 const directory=await runDirectory(),calls:string[]=[];let opens=0,committed=snap(0),ctx:WorldFactoryInput['context'];
 const factory:WorldPortsFactory=async input=>{opens++;ctx=input.context;committed={...snap(0),runId:input.runId};
  const adapter={observe:()=>()=>{},describe:async()=>({id:'amr-1'}),requestStop:async()=>({acknowledged:true,physicalStopConfirmed:false}),reconcile:async()=>({status:'unknown'})} as unknown as RobotAdapter;
  const coffee=createMockCoffeePorts(input.state,input.context,input.newBootId),advance=coffee.advance;if(failure==='coffee-commit')coffee.advance=async()=>{await advance();throw Error('COFFEE_COMMIT_FAILED');};return {navigation:{mapId:'lab-world',mapRevision:String(project.world.revision),bindings:Object.fromEntries(project.world.points.map((p:{id:string;x:number;y:number})=>[p.id,{waypointId:p.id,mapId:'lab-world',mapRevision:String(project.world.revision),frame:'map',x:p.x,y:p.y,yaw:Math.PI/2}]))},robots:new Map([['amr-1',adapter]]),coffee,snapshot:()=>committed,
   evidence:{async append(s){calls.push(`append:${s.tick}`);if(failure==='append'&&s.tick>0)throw Error('DISK_FAILED');},async fail(e){calls.push(`fail:${e.lastCommittedTick}:${e.targetTick}:${e.ackTick}`);},async finish(){calls.push('finish');}},
   world:{prepareTick(targetTick){calls.push(`prepare:${targetTick}`);return {targetTick,velocities:[],actorUpdates:[],jointTargets:[],gripperTargets:[],propPlacements:[]};},async step(c){calls.push(`step:${c.targetTick}`);if(failure==='lost')throw Error('WORKER_LOST');return {...snap(c.targetTick),runId:input.runId};},async commit(s){calls.push(`commit:${s.tick}:${ctx.tick()}:${ctx.nowMs()}`);if(failure==='source-write')await ctx.must('Session.Open',{sessionId:'forbidden',tableId:'table-1'});if(failure==='direct-source-write')await ctx.source.submit('Session.Open',{sessionId:'forbidden',tableId:'table-1'},'forbidden');if(failure==='commit')throw Error('COMMIT_FAILED');committed=s;},async close(){calls.push('close');}}};};
 const scenario=structuredClone(scenarioRegistry.get('MJ-BV01')!);for(const o of scenario.coffee!.orders)o.atTick=[5000,5000];
 const providers={directory,catalog,enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],scenarios:new Map([[scenario.id,scenario]]),worldPorts:factory};
 const open=()=>createScenarioRun(manifest,providers);return {open,calls,directory,opens:()=>opens,source:()=>ctx.source};
}
test('world path never constructs/advances mock AMR and commits actual pose with target observation time',async()=>{
 const h=await setup();vi.spyOn(MockPlant.prototype,'advance').mockImplementation(()=>{throw Error('MOCK_ADVANCE_FORBIDDEN');});
 const run=await h.open();try{await run.start();const v=await act(run,'step',{ticks:1});expect(((await h.source().read('robot','amr-1')).state.bindings as Record<string,{yaw:number}>)['coffee-pickup']!.yaw).toBe(Math.PI/2);expect(v.tick).toBe(1);expect(v.entities[0]!.pose.x).toBe(.351);expect(h.calls).toContain(`commit:1:1:${Date.parse('2026-11-01T00:00:00Z')+20}`);expect(h.calls.slice(0,4)).toEqual(['append:0','prepare:1','step:1','append:1']);}finally{await run.close();}
});
for(const failure of ['append','commit','source-write','direct-source-write','lost','coffee-commit'] as const)test(`world ${failure} failure keeps old public clock, latches and never retries or respawns`,async()=>{
 const h=await setup(failure),run=await h.open();await run.start();const watermark=(await run.journal()).at(-1)?.sequence??'0';
 await expect(act(run,'step',{ticks:1})).rejects.toThrow();const v=await run.snapshot();expect(v.tick).toBe(0);expect(v.entities[0]!.pose.x).toBe(.35);expect(v.entities[0]!.quality).toBe('stale');
 if(failure==='source-write'||failure==='direct-source-write'){const added=(await run.journal()).filter(e=>BigInt(e.sequence)>BigInt(watermark));expect(JSON.stringify(added)).not.toContain('forbidden');expect(JSON.stringify(added)).not.toContain('CupTransferred');}
 await expect(act(run,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');expect(h.calls.filter(c=>c.startsWith('step:'))).toHaveLength(1);expect(h.calls).toContain(`fail:0:1:${failure==='lost'?'null':'1'}`);await run.close();
 const reopened=await h.open();try{expect(h.opens()).toBe(1);expect((await reopened.snapshot()).entities[0]!.pose.x).toBe(.35);await expect(act(reopened,'step',{ticks:1})).rejects.toThrow('WORLD_TERMINAL');}finally{await reopened.close();}
});
