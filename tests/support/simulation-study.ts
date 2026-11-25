import {mkdtemp,readFile,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import type {PhysicsEvidenceV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {StudyArtifact} from '../../packages/lab-runtime/src/v2/simulation3d/simulation-input';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createWebotsCompiler} from '../../packages/lab-runtime/src/engineering/webots-compiler';
import {createNavigationCompiler} from '../../packages/lab-runtime/src/engineering/navigation-compiler';
import {engineeringPython} from './engineering-python';
export const sha=(b:string|Uint8Array)=>createHash('sha256').update(b).digest('hex');
export const artifact=(path:string,value:unknown)=>{const content=JSON.stringify(value,null,2)+'\n';return {ref:{path,sha256:sha(content),bytes:Buffer.byteLength(content)},content};};
export async function compileStudy(experiment='payload-center-v1',engine='mujoco_3d'){
 const dir=await mkdtemp(join(tmpdir(),'b08-compile-')),fixture=resolve('robotics/simulation-mujoco/fixtures/serve-payload-v1'),catalogRoot=join(dir,'catalog');
 const c=JSON.parse(await readFile(join(fixture,'serve-3d-components.json'),'utf8'));
 for(const sub of ['components','models','documents'])await mkdir(join(catalogRoot,sub),{recursive:true});
 for(const [id,doc]of Object.entries(c.components))await writeFile(join(catalogRoot,'components',id+'.json'),JSON.stringify(doc));
 for(const [id,doc]of Object.entries(c.models))await writeFile(join(catalogRoot,'models',id+'.json'),JSON.stringify(doc));
 await writeFile(join(catalogRoot,'catalog.json'),JSON.stringify({schemaVersion:1,id:'b08',components:Object.keys(c.components).map(digest=>({digest,file:`components/${digest}.json`})),quotes:[]}));
 const set=engine==='mujoco_3d'?'engineering-mujoco-3d-v1':engine==='webots_3d'?'engineering-webots-3d-v1':'engineering-irsim-2d-v1';
 const project={...JSON.parse(await readFile(join(fixture,'serve-3d-project.json'),'utf8')),requestedProfile:set,...engine==='mujoco_3d'?{mujocoExperimentId:experiment}:{}};
 const compiler=engine==='mujoco_3d'?createMujocoCompiler({workerRoot:resolve('robotics/simulation-mujoco')}):engine==='webots_3d'?createWebotsCompiler():createNavigationCompiler({python:engineeringPython,workerRoot:resolve('robotics/navigation-2d'),descriptionHelperRoot:resolve('robotics/simulation')});
 const service=createEngineeringService({directory:join(dir,'engineering'),catalogRoot,compiler,compilers:{[set]:compiler}});
 const receipt=await service.compileEngineeringProject(project,'study');if(receipt.state!=='compiled')throw Error(JSON.stringify(receipt.problems));
 const locked=await service.admitRun('study',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},set,undefined);
 const manifest=await service.readManifest('study',receipt.bundleDigest!);
 const artifacts=[];
 for(const f of manifest.files){const content=Buffer.from(await service.bundleFile(receipt.bundleDigest!,f.path)).toString();artifacts.push({ref:{path:f.path,sha256:sha(content),bytes:Buffer.byteLength(content)},content});}
 const scene=JSON.parse(artifacts.find(f=>f.ref.path==='navigation-scene.json')!.content);
 return {dir,service,locked,scene,project,artifacts,set,close:()=>rm(dir,{recursive:true,force:true})};
}
/** Unit-only report assembled on real compiled input bytes. It is never native execution evidence. */
export async function unitRun(c:Awaited<ReturnType<typeof compileStudy>>,runId='unit-a'){
 const {hashJson}=await import('../../packages/lab-runtime/src/v2/hash');
 const {buildNavigationEvidence,navigationMetrics}=await import('../../packages/lab-runtime/src/v2/navigation2d/evidence');
 const {scene}=c,sceneRef=c.artifacts.find(a=>a.ref.path==='navigation-scene.json')!.ref;
 const read={trajectory:[],control:[],sensors:[],collisions:[],issues:[],gaps:[],horizon:100,complete:true,reasons:[],terminal:null,text:{trajectory:'',control:'',sensors:'',collisions:''}};
 const profile=scene.engine.id==='mujoco_3d'?{seedAlgorithm:'mujoco-identity-seed-v1',limitation:'UNIT ONLY',engine:()=>({...scene.engine,engineVersion:'3.17.0',pythonVersion:'3.11.15',platform:'unit',lockDigest:'a'.repeat(64)})}:scene.engine.id==='webots_3d'?{seedAlgorithm:'webots-worldinfo-seed-v1',limitation:'UNIT ONLY',engine:()=>({id:'webots_3d',engineVersion:'R2025a',pythonVersion:'3.11.15',platform:'unit',lockDigest:'b'.repeat(64),basicTimeStepMs:20,executableSha256:'c'.repeat(64)})}:undefined;
 const nav=buildNavigationEvidence(scene,{runId,sourceCommit:'d'.repeat(40),sceneRef:{...sceneRef,path:'bundle/navigation-scene.json'},engine:{version:scene.engine.version,pythonVersion:'3.11.15'},lockDigest:'a'.repeat(64),numpyVersion:'2.2.6',runSeed:7,actorRng:{algorithm:'unit',seed:7},controller:{id:'grid-diff-v1',version:'2+mujoco-sent-ramp-v1'},businessEpochMs:0},{chunks:{trajectory:[],control:[],sensors:[],collisions:[]},gaps:[],terminal:null,lastTick:100},read,navigationMetrics(scene,read),100,undefined,profile);
 // scene engine has compiler-only fields; evidence's closed engine branch has its own supported shape.
 if(nav.engine.id==='mujoco_3d'){delete (nav.engine as unknown as Record<string,unknown>).version;delete (nav.engine as unknown as Record<string,unknown>).id;Object.assign(nav.engine,{id:'mujoco_3d'});}
 const world={...c.project.runtimeProject.world};delete world.revision;
 const at=(tick:number)=>new Date(tick*20).toISOString();
 const stops=[{id:'stop-1',action:'handoff',status:'awaiting_action',targetId:'bay-1',allocationIds:['allocation-1']}];
 const events=[{sequence:'1',at:at(10),type:'MissionArrived',kind:'mission',id:'mission-1',state:{currentStopId:'stop-1',stops}},{sequence:'2',at:at(60),type:'DeliveryHandedOff',kind:'allocation',id:'allocation-1',state:{missionId:'mission-1',lineId:'fulfillment-1'}},{sequence:'2',at:at(60),type:'FulfillmentServed',kind:'fulfillment',id:'fulfillment-1',state:{served:'1'}}];
 const metric={available:true,value:.1,unit:'m',samples:101};
 const report={schemaVersion:2,manifest:{runId,sourceCommit:'d'.repeat(40),mode:'simulation',access:'simulated',backends:[{id:scene.engine.id,version:scene.engine.version,model:'unit',dynamics:scene.engine.id!=='irsim_2d'}],clock:{tickMs:20,businessEpochMs:0},seed:7,scenario:{id:scene.engine.id==='mujoco_3d'?'MJ-FD01':scene.engine.id==='webots_3d'?'WB-FD01':'IR-FD01',revision:1,hash:'f'.repeat(64),basedOn:{id:'FD01',revision:1}},project:{id:c.project.runtimeProject.id,revision:1,hash:hashJson(c.locked.runtimeProjection.project)},world:{id:scene.world.id,revision:scene.world.revision,hash:hashJson(world)},engineering:c.locked.ref,models:[{id:scene.engine.id,hash:scene.sceneDigest}],configuration:{revision:1,hash:'e'.repeat(64)},assets:[],calibration:{status:'not_calibrated'}},outcome:{status:'completed',served:'1',tick:100,simTimeNs:'2000000000'},navigation2d:nav,businessEvents:events,effects:[],coverage:{},metrics:{distanceM:{'amr-1':1},collision:{available:true,contacts:0,minSeparationM:null}},confirmations:[{subjectId:'stop-1',confirmationType:'handoff',provenance:'scripted',tick:60}],physicsEvidence:scene.engine.id==='mujoco_3d'?{complete:true,issues:[],manifest:{identity:{runId,sceneDigest:scene.sceneDigest,loadProfileDigest:scene.engine.loadProfileRef.sha256,physicsProfileDigest:scene.engine.physicsProfileRef.sha256},coverage:{firstTick:0,lastTick:100,complete:true},gaps:[],terminalReason:null},metrics:{stopDistanceM:metric,maxTiltRad:{...metric,unit:'rad'}}}:undefined};
 const {scenarioRegistry,scenarioHash}=await import('../../packages/lab-runtime/src/v2/scenario-registry');report.manifest.scenario.hash=scenarioHash(scenarioRegistry.get(report.manifest.scenario.id)!);
 const artifacts:StudyArtifact[]=[...c.artifacts];await syntheticStreams(report as unknown as RunReport,c,artifacts);
 return {report:artifact('report.json',report),artifacts};
}

async function syntheticStreams(report:RunReport,c:Awaited<ReturnType<typeof compileStudy>>,artifacts:StudyArtifact[]){
 const {tick}=await import('./physics'),{physicsMetrics}=await import('../../packages/lab-runtime/src/v2/simulation3d/physics-metrics'),{preparePhysicsAdmission}=await import('../../packages/lab-runtime/src/v2/simulation3d/physics-evidence');
 const add=(prefix:string,stream:string,rows:unknown[])=>{const content=gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'),path=stream+'-000000-aaaaaaaa.ndjson.gz',ref={path,sha256:sha(content),bytes:content.length};artifacts.push({ref:{...ref,path:prefix+'/'+path},encoding:'base64',content:content.toString('base64')});return ref;};
 const trajectory=Array.from({length:101},(_,n)=>({tick:n,simTimeNs:String(BigInt(n)*20000000n),robots:[{robotId:'amr-1',poseDriveMap:c.scene.robots[0].initialPoseMap,bodyVelocity:[0,0],collisionIds:[]}]})),control=Array.from({length:100},(_,n)=>({tick:n,targetTick:n+1,singleStep:false,velocities:[{robotId:'amr-1',vMps:0,omegaRadps:0}],actorUpdates:[]}));
 report.navigation2d!.artifacts.trajectory=[{...add('evidence','trajectory',trajectory),firstTick:0,lastTick:100}];report.navigation2d!.artifacts.control=[{...add('evidence','control',control),firstTick:0,lastTick:99}];report.navigation2d!.completeness={status:'complete',reasons:[]};
 if(c.scene.engine.id!=='mujoco_3d')return;
 const prepared=await preparePhysicsAdmission(c.scene,async p=>Buffer.from(c.artifacts.find(a=>a.ref.path===p)!.content));
 const records=Array.from({length:101},(_,n)=>{const r=tick(n);r.contacts=[];for(const key of ['base','wheels','odometry'] as const)r[key][0]!.robotId='amr-1';r.loads=prepared.load.props.map(p=>({propId:p.propId,supportId:p.attachment.kind==='free'?p.attachment.supportId:null,poseMap:{positionM:[0,0,1],quaternionXyzw:[0,0,0,1]},poseInSupport:{positionM:[0,0,0],quaternionXyzw:[0,0,0,1]},linearVelocityMapMps:[0,0,0],angularVelocityMapRadps:[0,0,0]}));return r;});
 const manifest:PhysicsEvidenceV1={schemaVersion:1,documentType:'physics-evidence',identity:{...report.physicsEvidence!.manifest.identity,bootId:'unit-boot'},streams:[{stream:'physics',chunks:[add('physics','physics',records)]}],coverage:{firstTick:0,lastTick:100,complete:true},gaps:[],terminalReason:null,metricsPolicyDigest:c.scene.engine.stopPolicyRef.sha256,assumptions:prepared.load.assumptions};
 const m=artifact('physics/manifest.json',manifest);artifacts.push(m);report.physicsEvidence={complete:true,issues:[],manifest,manifestSha256:m.ref.sha256,metrics:physicsMetrics({complete:true,records,gaps:[],issues:[]},prepared.admission,{complete:true,trajectory,control,policy:c.scene.policy.parameters} as never)};
}
