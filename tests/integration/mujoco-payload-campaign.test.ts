import {afterEach,expect,test} from 'vitest';
import {sourceCommit as repoSourceCommit,sourceDirty as repoSourceDirty} from '../../scripts/repo-identity.mjs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createMujocoCompiler} from '../../packages/lab-runtime/src/engineering/mujoco-compiler';
import {createEngineeringService} from '../../packages/lab-runtime/src/engineering/gateway';
import {validateEngineeringProject} from '../../packages/lab-runtime/src/engineering/contracts';
import {navigationFixture} from '../support/navigation2d';
import {testCompiler,writeFixtureCatalog} from '../support/engineering';
const dirs:string[]=[];
const temp=async()=>{const p=await mkdtemp(join(tmpdir(),'payload-test-'));dirs.push(p);return p;};
afterEach(async()=>{for(const p of dirs.splice(0))await rm(p,{recursive:true,force:true});});
async function compile(id:string){
 const f=navigationFixture('serve-3d').fixture;f.project={...f.project,requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:id} as typeof f.project;
 const catalogRoot=await temp();await writeFixtureCatalog(catalogRoot,f);
 const service=createEngineeringService({directory:await temp(),catalogRoot,compiler:testCompiler,compilers:{'engineering-mujoco-3d-v1':createMujocoCompiler({workerRoot:resolve('robotics/simulation-mujoco')})}});
 const receipt=await service.compileEngineeringProject(f.project,'owner');expect(receipt.state,JSON.stringify(receipt.problems)).toBe('compiled');
 const read=async(p:string)=>JSON.parse(Buffer.from(await service.bundleFile(receipt.bundleDigest!,p)).toString());return {service,scene:await read('navigation-scene.json'),read,receipt};
}
test('registered empty and offset select genuine frozen load fixtures; browser cannot supply physics',async()=>{
 for(const id of ['payload-empty-v1','payload-offset-v1']){const {scene,read}=await compile(id);const load=await read(scene.engine.loadProfileRef.path);expect(load.id).toBe(id.includes('empty')?'empty':'cup-offset');expect(load.props.length).toBe(id.includes('empty')?0:1);}
 const project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-payload-v1/serve-3d-project.json','utf8'));
 expect(validateEngineeringProject({...project,mujocoExperimentId:'../../custom.json'}).ok).toBe(false);
 expect(validateEngineeringProject({...project,physics:{contact:{sliding:0}}}).ok).toBe(false);
});
test('speed experiments bind applied policy and projection while preserving mechanics and controller algorithm bytes',async()=>{
 const base=await compile('payload-center-v1'),slow=await compile('payload-slow-v1');
 expect(slow.scene.policy.id).toBe('payload-slow-v1-navigation-policy');expect(slow.scene.policy.source.documentId).toBe('payload-experiments-v1');
 expect(slow.scene.policy.parameters.maxLinearMps).toBe(.2);expect(slow.scene.policy.parameters.maxAngularRadps).toBe(.4);
 expect(slow.scene.robots[0].model.kinematics.maxLinearMps).toBe(.2);
 expect(slow.scene.engine.physicsProfileRef).toEqual(base.scene.engine.physicsProfileRef);
 expect(slow.scene.engine.controllerPolicyRef).toEqual(base.scene.engine.controllerPolicyRef);
 expect(slow.scene.files.find((f:{path:string})=>f.path==='canonical-physical-model.json')).toEqual(base.scene.files.find((f:{path:string})=>f.path==='canonical-physical-model.json'));
 expect((await slow.read('cup-center.json')).modelRef.sha256).not.toBe((await base.read('cup-center.json')).modelRef.sha256);
 expect(slow.scene.policy.hash).not.toBe(base.scene.policy.hash);expect(slow.scene.sceneDigest).not.toBe(base.scene.sceneDigest);expect(slow.receipt.projectDigest).not.toBe(base.receipt.projectDigest);
});

test('mobile committed payload samples carry admitted geometry and map pose without custody; empty has none',async()=>{
 const {createFixedStepScenarioRun}=await import('../../packages/lab-runtime/src/v2/navigation2d/runner');
 const {defaultCatalog}=await import('../../packages/lab-runtime/src/v2/capabilities');
 const {mujocoMobilePlant}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile');
 const {lockDigestOf}=await import('../../packages/lab-runtime/src/engineering/linkforge');
 const {validateTwinSampleV2}=await import('../../packages/lab-runtime/src/v2/contracts');
 for(const id of ['payload-center-v1','payload-empty-v1']){
  const {service,receipt}=await compile(id),locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
  const workerRoot=resolve('robotics/simulation-mujoco'),runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
  const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
  const run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'telemetry-test',engineering:locked},{directory:await temp(),catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant:mujocoMobilePlant(runtime),runtime});
  try{await run.start();const v=await run.snapshot();await run.action({actionId:'step',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:5}});const report=await run.report();
   const payload=report.telemetry.samples.filter(s=>s.entityId.startsWith('payload:'));
   if(id==='payload-empty-v1'){expect(payload).toEqual([]);expect(report.entities.filter(e=>e.kind==='payload')).toEqual([]);}
   else{expect(payload.length).toBeGreaterThan(0);for(const s of payload){expect(validateTwinSampleV2(s).ok).toBe(true);expect(s).toMatchObject({origin:'physics_sim',frameId:'map',quality:'valid',observed:{payloadKind:'free',geometry:{kind:'cylinder',radiusM:.04,heightM:.1}}});expect(s.observed).not.toHaveProperty('ownerKind');}expect(report.entities.find(e=>e.kind==='payload')).toMatchObject({id:'payload:cup-1',plant:{payloadKind:'free'},distanceM:null,moving:expect.any(Boolean)});}
  }finally{await run.close();}
 }
},30000);

test('campaign readback refuses a missing run set instead of trusting a summary',async()=>{
 const module=await import('../../packages/lab-runtime/src/v2/simulation3d/payload-campaign');
 const d=await temp();const {writeFile}=await import('node:fs/promises');await writeFile(join(d,'summary.json'),JSON.stringify({accepted:true,completedCases:18}));
 const verdict=await module.verifyPayloadCampaign(d);expect(verdict.expectedRuns).toBe(19);expect(verdict.completedCases).toBe(0);expect(verdict.missingArtifacts.length).toBeGreaterThan(0);
});

test('actual 19-run campaign round-trips, and missing/skip/seed/profile/corrupt/fault mutations cannot pass',async()=>{
 const {runPayloadCampaign,verifyPayloadCampaign}=await import('../../packages/lab-runtime/src/v2/simulation3d/payload-campaign');
 const {writeFile,rename,cp,readdir,lstat}=await import('node:fs/promises');const {createHash}=await import('node:crypto');
 const out=join(await temp(),'campaign');
 // Optional fresh output from this build's CLI recording avoids a second native campaign; mutation tests always use a private temporary copy.
 if(process.env.PAYLOAD_CAMPAIGN_EVIDENCE)await cp(process.env.PAYLOAD_CAMPAIGN_EVIDENCE,out,{recursive:true,errorOnExist:true});
 const head=repoSourceCommit('.'),dirty=repoSourceDirty('.');
 const inventory=async()=>Promise.all((await readdir(out,{recursive:true})).sort().map(async p=>{const info=await lstat(join(out,p));return info.isFile()?[p,info.size,createHash('sha256').update(await readFile(join(out,p))).digest('hex')]:[p,'directory'];}));
 const before=process.env.PAYLOAD_CAMPAIGN_EVIDENCE?await inventory():null;
 const verdict=process.env.PAYLOAD_CAMPAIGN_EVIDENCE?await verifyPayloadCampaign(out):await runPayloadCampaign({root:resolve('.'),out,sourceCommit:head+(dirty?'-dirty':'')});
 expect(verdict,JSON.stringify(verdict)).toMatchObject({expectedRuns:19,completedCases:19,issues:[],missingArtifacts:[]});expect(verdict.faultCases.every(f=>f.detected&&!f.falseServed)).toBe(true);
 if(before)expect(await inventory()).toEqual(before);const retained=await inventory();expect(await verifyPayloadCampaign(out)).toEqual(verdict);expect(await inventory()).toEqual(retained);
 const reject=async()=>{const retained=await inventory(),v=await verifyPayloadCampaign(out);expect(v.completedCases).toBeLessThan(19);expect(v.issues.length).toBeGreaterThan(0);expect(await inventory()).toEqual(retained);};
 const missing=join(out,'turn-empty-s7');await rename(missing,missing+'-hidden');try{await reject();}finally{await rename(missing+'-hidden',missing);}
 const file=join(out,'turn-center-s7','case.json'),original=await readFile(file);
 for(const mutate of [(r:Record<string,Record<string,unknown>>)=>r.case.seed=99,(r:Record<string,Record<string,unknown>>)=>r.case.experimentId='payload-empty-v1',(r:Record<string,Record<string,unknown>>)=>r.case.skip=true]){const r=JSON.parse(original.toString());mutate(r);await writeFile(file,JSON.stringify(r));try{await reject();}finally{await writeFile(file,original);}}
 const artifact=join(out,'turn-offset-s7','run','physics','manifest.json'),bytes=await readFile(artifact);await writeFile(artifact,'{}');try{await reject();}finally{await writeFile(artifact,bytes);}
 const faultFile=join(out,'ack-loss','case.json'),faultBytes=await readFile(faultFile),fault=JSON.parse(faultBytes.toString());fault.case.kind='worker-kill';await writeFile(faultFile,JSON.stringify(fault));try{await reject();}finally{await writeFile(faultFile,faultBytes);}
},1500000);

test('health exposes registered selectors only with engineering and an enabled reachable mobile provider',async()=>{
 const {startLabGateway}=await import('../../packages/lab-runtime/src/gateway');const {defaultCatalog}=await import('../../packages/lab-runtime/src/v2/capabilities');
 const {service}=await compile('payload-center-v1');
 for(const enabled of [false,true]){
  const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
  const gateway=await startLabGateway({port:0,directory:await temp(),sourceCommit:'test',schemaHash:'a'.repeat(64),v2:{catalog,enabledBackends:enabled?['mujoco_3d']:[],engineering:service}});
  try{const health=await (await fetch(gateway.url+'/lab/v2/health')).json();if(enabled){expect(health.mobilePayloadExperiments.map((e:{id:string})=>e.id)).toContain('payload-empty-v1');expect(health.capabilities).toContain('sim3d_payload_experiments_v1');expect(JSON.stringify(health.mobilePayloadExperiments)).not.toContain('path');}else{expect(health.mobilePayloadExperiments).toBeUndefined();expect(health.capabilities).not.toContain('sim3d_payload_experiments_v1');}}
  finally{await gateway.close();}
 }
});

test('a registered real impulse reaches LOAD_FELL after contact without serving or respawning',async()=>{
 const {createFixedStepScenarioRun}=await import('../../packages/lab-runtime/src/v2/navigation2d/runner');const {defaultCatalog}=await import('../../packages/lab-runtime/src/v2/capabilities');
 const {mujocoMobilePlant,MOBILE_PAYLOAD_IMPULSE}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile');const {lockDigestOf}=await import('../../packages/lab-runtime/src/engineering/linkforge');
 const {service,receipt}=await compile('payload-center-v1'),locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const workerRoot=resolve('robotics/simulation-mujoco'),runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 const directory=await temp(),run=await createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'fall-test',engineering:locked},{directory,catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant:mujocoMobilePlant(runtime,'payload-cup-forward-impulse-v1'),runtime});
 try{await run.start();let v=await run.snapshot(),i=0;while(v.tick<650&&!v.attention.some(a=>a.reason==='LOAD_FELL')){v=await run.action({actionId:`step-${++i}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:25}});}
 const report=await run.report();expect(report.attention.map(a=>a.reason)).toContain('LOAD_FELL');expect(report.outcome.served).toBe('0');expect(report.entities.find(e=>e.kind==='payload')?.moving).toBe(true);expect(report.manifest.simulationPerturbation).toEqual(MOBILE_PAYLOAD_IMPULSE);expect(report.physicsEvidence?.issues).toEqual(['PHYSICS_COVERAGE_INCOMPLETE']);expect(report.physicsEvidence?.manifest.gaps).toEqual([]);
 await expect(run.action({actionId:'again',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}})).rejects.toThrow('PLANT_LOST');
 console.log('PAYLOAD_FALL',JSON.stringify({tick:v.tick,attention:report.attention,receipt:JSON.parse(await readFile(join(directory,'worker/payload-perturbation.json'),'utf8'))}));
 }finally{await run.close();}
},60000);

test.each(['complete','restart','ack-loss'])('registered braking observation tail has a durable terminal boundary: %s',async mode=>{
 const {createFixedStepScenarioRun}=await import('../../packages/lab-runtime/src/v2/navigation2d/runner');const {defaultCatalog}=await import('../../packages/lab-runtime/src/v2/capabilities');
 const {mujocoMobilePlant}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile');const {lockDigestOf}=await import('../../packages/lab-runtime/src/engineering/linkforge');
 const {service,receipt}=await compile('payload-slow-v1'),locked=await service.admitRun('owner',{bundleDigest:receipt.bundleDigest,projectDigest:receipt.projectDigest},'engineering-mujoco-3d-v1',undefined);
 const workerRoot=resolve('robotics/simulation-mujoco'),runtime={python:resolve('.venv-mujoco/bin/python'),workerRoot,schemaDir:resolve('packages/contracts/schemas'),lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock')),engineVersion:'3.17.0',maxActiveRuns:1};
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_3d'?{...b,installed:true,compatible:true,reachable:true}:b)};
 const {WorkerLostError}=await import('../../packages/lab-runtime/src/v2/navigation2d/plant');
 let loseAck=false,spawns=0;const steps:{tick:number;velocities:unknown}[]=[];
 const plant=mujocoMobilePlant(runtime,'payload-brake-observation-v1'),spawn=plant.spawn;
 plant.spawn=async options=>{spawns++;const w=await spawn(options);return {get state(){return w.state;},get pid(){return w.pid;},get bootId(){return w.bootId;},get stderrTail(){return w.stderrTail;},close:(reason:string)=>w.close(reason),async request(req){const r=await w.request(req);if(req.op==='step'){steps.push({tick:req.expectedTick+1,velocities:(req.payload as {velocities:unknown}).velocities});if(loseAck)throw new WorkerLostError('WORKER_TIMEOUT','unknown','tail ACK lost after actual advancement');}return r;}};};
 const directory=await temp(),open=()=>createFixedStepScenarioRun({project:locked.runtimeProjection.project,scenarioId:'MJ-FD01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-3d-v1',sourceCommit:'brake-test',engineering:locked},{directory,catalog,enabledBackends:['mujoco_3d'],bundleFile:(d,p)=>service.bundleFile(d,p),plant,runtime});
 let run=await open();
 try{await run.start();let v=await run.snapshot();v=await run.action({actionId:'drive',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:500}});v=await run.action({actionId:'cancel',expectedRevision:v.run.runRevision,kind:'cancel',payload:{}});
 let cp=JSON.parse(await readFile(join(directory,'run.json'),'utf8')),i=0;
 // A real one-tick consumer stops on terminal status; that must not strand the observation window.
 while(v.run.status==='running'&&!cp.completionTail&&i<250){v=await run.action({actionId:`stop-${++i}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}});cp=JSON.parse(await readFile(join(directory,'run.json'),'utf8'));}
 expect(cp.completionTail).toBeDefined();expect(v.tick).toBe(cp.completionTail.firstTick);expect(v.run.status).toBe('running');
 const mid=await run.report();expect(mid.outcome.status).toBe('running');expect(mid.businessEvents.some(e=>e.type==='RobotCommandObserved'&&e.state.status==='cancelled')).toBe(true);
 const effectIds=mid.effects.map(e=>e.id),confirmed=mid.confirmations;
 if(mode==='restart'){
  await run.close();run=await open();v=await run.snapshot();expect(v.run.status).toBe('needs_attention');expect(v.attention.map(a=>a.reason)).toContain('RECOVERY_UNKNOWN');
  expect((await run.report()).outcome.status).toBe('needs_attention');await expect(run.action({actionId:'after-restart',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}})).rejects.toThrow('PLANT_LOST');expect(spawns).toBe(1);return;
 }
 if(mode==='ack-loss')loseAck=true;
 while(v.run.status==='running'&&v.tick<cp.completionTail.lastTick){v=await run.action({actionId:`tail-${++i}`,expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}});}
 const report=await run.report();expect(report.effects.map(e=>e.id)).toEqual(effectIds);expect(report.confirmations).toEqual(confirmed);expect(report.outcome.served).toBe('0');expect(spawns).toBe(1);
 for(const step of steps.filter(s=>s.tick>cp.completionTail.firstTick))expect(step.velocities).toEqual([{robotId:'amr-1',vMps:0,omegaRadps:0}]);
 if(mode==='ack-loss'){
  expect(v.run.status).toBe('needs_attention');expect(v.tick).toBe(cp.completionTail.firstTick);expect(steps.at(-1)?.tick).toBe(v.tick+1);expect(report.physicsEvidence?.complete).toBe(false);
  await expect(run.action({actionId:'retry',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}})).rejects.toThrow('PLANT_LOST');expect(steps.at(-1)?.tick).toBe(v.tick+1);
 }else{
  expect(v.tick).toBe(cp.completionTail.lastTick);expect(v.run.status).toBe('cancelled');expect(report.outcome.status).toBe('cancelled');expect(report.physicsEvidence?.metrics.stopDistanceM.available).toBe(true);expect(report.physicsEvidence?.complete).toBe(true);expect(report.manifest.completionObservation).toEqual({id:'payload-brake-observation-v1',extraTicks:5});
  await expect(run.action({actionId:'extra',expectedRevision:v.run.runRevision,kind:'step',payload:{ticks:1}})).rejects.toThrow('RUN_FINISHED');
 }
 }finally{await run.close();}
},60000);
