// Dev-only Lab v2 fixtures for the mock scenario runner tests. In-process providers only; nothing here reaches the gateway.
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {serviceAmrAsset} from '../../packages/lab-runtime/src/v2/assets';
import {createScenarioRun,type RunManifestInput,type RunProviders,type ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {scenarioRegistry,type ScenarioDefinition} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {PUMA560_SI} from '../../packages/lab-runtime/src/v2/models/arm-kinematics';
export const amrAsset=serviceAmrAsset({id:'service-robot',revision:1,chassis:'service',trays:3,sensor:'lidar'});
export const amrRef={id:amrAsset.id,revision:amrAsset.revision,contentHash:amrAsset.contentHash};
const furniture=[2.4,5.4,8.4].flatMap((x,i)=>[{id:`furniture-${i+1}`,x,y:1.55,width:1.2,height:0.9},{id:`furniture-${i+4}`,x,y:4.55,width:1.2,height:0.9}]);
/** Six-table restaurant (same layout as lab/fixtures/twins/restaurant-v2.json); ids deliberately differ from the v1 fixed names. */
export const restaurant=(over:{entities?:unknown[];obstacles?:unknown[];points?:unknown[]}={})=>({schemaVersion:2,id:'restaurant',name:'Restaurant',revision:1,updatedAt:'2026-11-05T00:00:00Z',
 entities:over.entities??[{id:'amr-1',kind:'amr',assetRef:amrRef}],
 world:{id:'restaurant-world',revision:1,width:12,height:8,points:over.points??[{id:'t-north',name:'T01',kind:'table',x:3,y:1.1},{id:'t-south',name:'T04',kind:'table',x:3,y:4.1},{id:'pass',name:'Kitchen pass',kind:'kitchen',x:1,y:6.8},{id:'bay-1',name:'Parking',kind:'parking',x:1,y:1}],obstacles:over.obstacles??furniture}});
/** Two parking bays left of a wall whose only opening is a 1 m corridor: one 0.82 m robot fits, two side by side do not. */
export const corridor=()=>({schemaVersion:2,id:'corridor',name:'Corridor',revision:1,updatedAt:'2026-11-05T00:00:00Z',
 entities:[{id:'amr-b',kind:'amr',assetRef:amrRef},{id:'amr-a',kind:'amr',assetRef:amrRef}],
 world:{id:'corridor-world',revision:1,width:10,height:6,points:[{id:'bay-a',name:'Bay A',kind:'parking',x:1,y:1},{id:'bay-b',name:'Bay B',kind:'parking',x:1,y:5},{id:'pass',name:'Pass',kind:'kitchen',x:1,y:3},{id:'east-1',name:'E1',kind:'table',x:8.5,y:1.5},{id:'east-2',name:'E2',kind:'table',x:8.5,y:4.5}],
  obstacles:[{id:'wall-south',x:4.5,y:0,width:1,height:2.5},{id:'wall-north',x:4.5,y:3.5,width:1,height:2.5}]}});
const dirs:string[]=[];
export async function cleanupRuns(){for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});}
export async function runDirectory(){const d=await mkdtemp(join(tmpdir(),'lab-v2-run-'));dirs.push(d);return join(d,'run');}
export interface FixtureOptions {seed:number;project?:unknown;assets?:RunProviders['assets'];scenarios?:Record<string,ScenarioDefinition>;directory?:string;scenarioRevision?:number}
export const manifestFor=(scenarioId:string,o:FixtureOptions,scenarios=scenarioRegistry):RunManifestInput=>({project:o.project??(scenarioId.startsWith('FD07')?corridor():restaurant()),scenarioId,scenarioRevision:o.scenarioRevision??(o.scenarios?.[scenarioId]??scenarios.get(scenarioId))!.revision,seed:o.seed,mode:'mock',access:'simulated',backendSetId:'mock-amr',sourceCommit:'test-commit'});
export async function openFixture(scenarioId:string,o:FixtureOptions):Promise<ScenarioRun>{
 const scenarios=new Map([...scenarioRegistry,...Object.entries(o.scenarios??{})]);
 return createScenarioRun(manifestFor(scenarioId,o,scenarios),{directory:o.directory??await runDirectory(),assets:o.assets??[amrAsset],enabledBackends:['mock_amr'],scenarios});
}
let actionCounter=0;
export async function act(run:ScenarioRun,kind:string,payload:Record<string,unknown>={}){const view=await run.snapshot();return run.action({actionId:`a-${++actionCounter}`,expectedRevision:view.run.runRevision,kind,payload});}
/** Step until the run leaves running (or `until` holds), in bounded chunks. */
export async function stepUntil(run:ScenarioRun,until:(v:Awaited<ReturnType<ScenarioRun['snapshot']>>)=>boolean=v=>['completed','needs_attention','cancelled'].includes(v.run.status),chunk=25,limit=40000){
 let view=await run.snapshot();
 while(!until(view)){if(view.tick>limit)throw new Error(`STEP_LIMIT at ${view.tick}: ${view.run.status}`);view=await act(run,'step',{ticks:chunk});}
 return view;
}
/** FD fixture: fixed seed + scripted inputs, stepped to its outcome; returns the report built from the source journal. */
export async function executeFixture(scenarioId:string,o:FixtureOptions){
 const run=await openFixture(scenarioId,o);
 try{await run.start();await stepUntil(run,undefined,500);return await run.report();}finally{await run.close();}
}
/** Declared illustrative arm scene. TCP place maps near the pickup at (3,1); heights are model inputs, not measurements. */
export const coffeeArmCollisionProfile=()=>({schemaVersion:1 as const,id:'coffee-arm-scene',revision:1,units:'SI' as const,provenance:'illustrative' as const,
 reference:'Illustrative PUMA base alignment and extruded fixture/AMR heights; not calibrated or physical safety evidence',modelId:PUMA560_SI.id,modelRevision:PUMA560_SI.revision,
 baseInMap:{position:[2.794821,0.941325,1.2],quaternionXyzw:[0,0,0,1]},fixtureHeightM:1,robotHeightM:0.7});
/** Coffee cell beside a table: scene obstacles are project rectangles, AMR width comes from its compiled asset. */
export const coffeeProject=()=>({schemaVersion:2,id:'coffee-cell-lab',name:'Coffee cell',revision:1,updatedAt:'2026-11-05T00:00:00Z',
 armCollisionProfile:coffeeArmCollisionProfile(),
 entities:[{id:'amr-1',kind:'amr',assetRef:amrRef},{id:'arm-1',kind:'arm',assetRef:{id:'arm-puma-reference',revision:1,contentHash:'f'.repeat(64)}},{id:'coffee-1',kind:'coffee_machine',assetRef:{id:'coffee-machine-illustrative',revision:1,contentHash:'e'.repeat(64)}}],
 world:{id:'coffee-cell-world',revision:1,width:6,height:4,points:[{id:'parking',name:'Parking',kind:'parking',x:0.8,y:0.8},{id:'coffee-pickup',name:'Coffee pickup',kind:'coffee_pickup',x:3,y:1},{id:'table-1',name:'T01',kind:'table',x:5,y:3}],obstacles:[]}});
export const COFFEE_BACKENDS=['mock_amr','mock_coffee','mock_arm'];
export async function openCoffee(scenarioId:string,o:FixtureOptions):Promise<ScenarioRun>{
 const scenarios=new Map([...scenarioRegistry,...Object.entries(o.scenarios??{})]);
 return createScenarioRun({...manifestFor(scenarioId,{...o,project:o.project??coffeeProject()},scenarios),backendSetId:'mock-default'},{directory:o.directory??await runDirectory(),assets:o.assets??[amrAsset],enabledBackends:COFFEE_BACKENDS,scenarios});
}
export async function executeCoffee(scenarioId:string,o:FixtureOptions){
 const run=await openCoffee(scenarioId,o);
 try{await run.start();await stepUntil(run,undefined,500);return await run.report();}finally{await run.close();}
}
