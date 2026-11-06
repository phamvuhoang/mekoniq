// Protocol-double routing only: no simulator or controller executes in this suite.
import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {collectReadiness,type ReadinessCheck} from '../../packages/lab-runtime/src/v2/readiness';
import {coffeeProject} from '../support/lab-v2';
import type {ScenarioRun,RunView,RunProviders} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {TelemetryRecorder} from '../../packages/lab-runtime/src/v2/telemetry';
const roots:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const g of gateways.splice(0))await g.close();for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
const ids=['gazebo_nav2','coffee_io_sim','linuxcnc_sim'];
const catalog=()=>({...structuredClone(defaultCatalog),backends:defaultCatalog.backends.map(b=>ids.includes(b.id)?{...b,installed:true,compatible:true,reachable:true,commissioned:true}:b)});
const checks=():ReadinessCheck[]=>['model','clock','fixture','profile','runner','gripper'].map(id=>({id,status:'ready',reasonCodes:[],evidenceRef:'protocol_double'}));
const input=()=>({project:coffeeProject(),scenarioId:'BV01',scenarioRevision:1,seed:23,mode:'simulation',access:'simulated',backendSetId:'coffee-simulation',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}});
async function pair(g:LabGateway){const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});return {cookie:r.headers.get('set-cookie')!.split(';')[0]!,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':String((await r.json()).csrfToken)};}
test('native provider checks resolve native placeholders but cannot override host or world authority',async()=>{
 const r=await collectReadiness({scenarioId:'BV01',backendSetId:'coffee-simulation',project:coffeeProject()},{catalog:catalog(),enabledBackends:ids,nativeChecks:async()=>checks()});
 expect(r.checks.find(c=>c.id==='runner')?.status).toBe('ready');if(process.platform!=='linux')expect(r.canStart).toBe(false);
 const bad=await collectReadiness({scenarioId:'BV01',backendSetId:'coffee-simulation'},{catalog:catalog(),enabledBackends:ids,nativeChecks:async()=>[...checks(),{id:'host',status:'ready',reasonCodes:[],evidenceRef:null}]});expect(bad.canStart).toBe(false);expect(bad.checks.flatMap(c=>c.reasonCodes)).toContain('NATIVE_PROBE_INVALID');
});
test('native create and proof-protected reclaim use the same configured factory and id',async()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('linux');
 const directory=await mkdtemp(join(tmpdir(),'native-gateway-'));roots.push(directory);const id=randomUUID(),seen:string[]=[],view={run:{schemaVersion:2,id,mode:'simulation',access:'simulated',backendSetId:'coffee-simulation',backends:ids,status:'ready',runRevision:0,eventCursor:null,telemetryCursor:null,fidelity:'modeled',ageMs:0,sourceCommit:'test-commit',scenarioId:'BV01',scenarioRevision:1,seed:23},tick:0,simTimeNs:'0',model:'physics_sim',entities:[],workload:[],awaiting:[],attention:[],served:'0',coffee:null} as RunView;
 const factory=async(i:{mode:string},providers:RunProviders)=>{seen.push(i.mode);await mkdir(providers.directory,{recursive:true});return {id,start:async()=>view,action:async()=>view,report:async()=>{throw new Error('PROTOCOL_DOUBLE_NO_REPORT');},snapshot:async()=>view,holdForReclaim:async()=>view,close:async()=>{},telemetry:new TelemetryRecorder(),journal:async()=>[],pulse:()=>({tick:0,paused:true,runRevision:0})} as ScenarioRun;};
 const options={port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{catalog:catalog(),enabledBackends:ids,simulationFactory:factory,nativeChecks:async()=>checks()}};
 const g=await startLabGateway(options);const headers=await pair(g),r=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers,body:JSON.stringify(input())});expect(r.status).toBe(201);const created=await r.json();expect(created.run.id).toBe(id);await g.close();
 const reopened=await startLabGateway(options);gateways.push(reopened);const h=await pair(reopened),reclaim=await fetch(reopened.url+`/lab/v2/runs/${id}/reclaim`,{method:'POST',headers:h,body:JSON.stringify({proof:created.reclaimToken})});expect(reclaim.status).toBe(200);expect((await reclaim.json()).run.mode).toBe('simulation');expect(seen).toEqual(['simulation','simulation']);
});
test('native factory failure preserves its attempt journal for diagnosis',async()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('linux');const directory=await mkdtemp(join(tmpdir(),'native-attempt-'));roots.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{catalog:catalog(),enabledBackends:ids,nativeChecks:async()=>checks(),simulationFactory:async(_input,providers)=>{await mkdir(providers.directory,{recursive:true});await writeFile(join(providers.directory,'attempt.json'),'{}');throw new Error('INITIALIZATION_FAILED');}}});gateways.push(g);
 const response=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:await pair(g),body:JSON.stringify(input())});expect(response.status).toBe(500);const dirs=await readdir(directory);expect(dirs).toHaveLength(1);expect(await readdir(join(directory,dirs[0]!))).toContain('attempt.json');
});
