// Real HTTP admission/serialization; only the expensive native simulator is replaced at its boundary.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import type {RunManifestInput} from '../../packages/lab-runtime/src/v2/scenario-runner';
const dirs:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
test.each([true,false,undefined])('HTTP admits the program exactly when health advertises it (worldExperiments=%s)',async(worldExperiments)=>{
 const directory=await mkdtemp(join(tmpdir(),'grasp-gateway-'));dirs.push(directory);let received:RunManifestInput|undefined,readinessCalls=0;
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const g=await startLabGateway({port:0,directory,sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),v2:{worldExperiments,catalog,enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],portableChecks:async()=>{readinessCalls++;return ['model','clock','fixture','profile','runner','gripper'].map(id=>({id,status:'ready',reasonCodes:[],evidenceRef:'test-native-boundary'}));},simulationFactory:async(input)=>{received=input;throw Error('TEST_NATIVE_BOUNDARY');}}});gateways.push(g);
 const health=await(await fetch(g.url+'/lab/v2/health')).json() as {worldExperiments?:{id:string;requiresNewRun:boolean}[];graspModes?:{id:string;programIds?:string[]}[]};
 if(worldExperiments){expect(health.graspModes!.find(m=>m.id==='fixed_program')!.programIds).toBeUndefined();
  for(const mode of ['belief_ground_truth','belief_estimated'])expect(health.graspModes!.find(m=>m.id===mode)!.programIds).toEqual(['cup-pick-two-stage-v1']);
 }else expect(health.graspModes).toBeUndefined();
 const origin='http://127.0.0.1:4175',paired=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});
 const token=(await paired.json()).sessionToken as string,project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json','utf8'));
 const request={project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',graspProgramId:'cup-pick-two-stage-v1',runtimeIdentity:{sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64)}};
 const post=(body:unknown)=>fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body)}),before=await readdir(directory),response=await post(request);
 if(worldExperiments){expect(response.status).toBe(500);expect(received).toMatchObject({graspProgramId:'cup-pick-two-stage-v1',graspMode:'belief_estimated',recoveryPolicyId:'pick-recovery-v1'});}
 else{
  expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:'GRASP_PROGRAM_UNAVAILABLE',reasonCodes:['GRASP_PROGRAM_UNAVAILABLE']});
  expect(received).toBeUndefined();expect(readinessCalls).toBe(0);expect(await readdir(directory)).toEqual(before);
  // A request without the new program keeps the pre-existing admission path.
  expect((await post({...request,graspProgramId:undefined})).status).toBe(500);expect(received).toMatchObject({graspMode:'belief_estimated'});expect(received!.graspProgramId).toBeUndefined();
 }
 const pulse={...request,worldExperimentId:'world-cup-nudge-v2'};
 if(worldExperiments){
  expect(health.worldExperiments).toContainEqual(expect.objectContaining({id:pulse.worldExperimentId,requiresNewRun:true}));
  expect((await post(pulse)).status).toBe(500);expect(received).toMatchObject({worldExperimentId:pulse.worldExperimentId});
  for(const patch of [{graspProgramId:undefined},{graspMode:'fixed_program'},{scenarioId:'MJ-BV01'},{worldExperimentId:'world-cup-nudge-v3'},{segmentIndex:0}])expect((await post({...pulse,...patch})).status).toBe(422);
 }else{expect(health.worldExperiments).toBeUndefined();expect((await post(pulse)).status).toBe(422);}

});
