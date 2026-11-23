// Real HTTP admission/serialization; only the expensive native simulator is replaced at its boundary.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import type {RunManifestInput} from '../../packages/lab-runtime/src/v2/scenario-runner';
const dirs:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
test('health advertises the registered program for belief modes and HTTP forwards its ID unchanged to the runtime',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'grasp-gateway-'));dirs.push(directory);let received:RunManifestInput|undefined;
 const catalog={...defaultCatalog,backends:defaultCatalog.backends.map(b=>['mujoco_arm','mujoco_3d'].includes(b.id)?{...b,installed:true,compatible:true,reachable:true}:b)};
 const g=await startLabGateway({port:0,directory,sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64),v2:{worldExperiments:true,catalog,enabledBackends:['mujoco_3d','mujoco_arm','mock_coffee'],portableChecks:async()=>['model','clock','fixture','profile','runner','gripper'].map(id=>({id,status:'ready',reasonCodes:[],evidenceRef:'test-native-boundary'})),simulationFactory:async(input)=>{received=input;throw Error('TEST_NATIVE_BOUNDARY');}}});gateways.push(g);
 const health=await(await fetch(g.url+'/lab/v2/health')).json() as {graspModes:{id:string;programIds?:string[]}[]};
 expect(health.graspModes.find(m=>m.id==='fixed_program')!.programIds).toBeUndefined();
 for(const mode of ['belief_ground_truth','belief_estimated'])expect(health.graspModes.find(m=>m.id===mode)!.programIds).toEqual(['cup-pick-two-stage-v1']);
 const origin='http://127.0.0.1:4175',paired=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});
 const token=(await paired.json()).sessionToken as string,project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json','utf8'));
 const response=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-cell-v1',graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',graspProgramId:'cup-pick-two-stage-v1',runtimeIdentity:{sourceCommit:'a'.repeat(40),schemaHash:'b'.repeat(64)}})});
 expect(response.status).toBe(500);expect(received).toMatchObject({graspProgramId:'cup-pick-two-stage-v1',graspMode:'belief_estimated',recoveryPolicyId:'pick-recovery-v1'});
});
