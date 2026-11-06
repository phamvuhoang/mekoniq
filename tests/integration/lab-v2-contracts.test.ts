import {afterEach,expect,test} from 'vitest';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hashPayload,type CellCommand,type CellObservation} from '../../packages/contracts/src/index';
import {admitBackend,defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {validateProjectV2,validateRunRequestV2,validateActionV2,validateTwinSampleV2,validateAssetRevision,validateCoffeeRecipe,validateCellCommand,validateCellObservation,validateEvidenceV2,matchObservation} from '../../packages/lab-runtime/src/v2/contracts';
import {validateProject} from '../../packages/lab-runtime/src/session';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';

const hash='a'.repeat(64);
const catalog:CapabilityCatalog=defaultCatalog;
const asset={id:'amr-asset',revision:1,contentHash:hash};
const coffeeProject={schemaVersion:2,id:'coffee-lab',name:'Coffee lab',revision:1,updatedAt:'2026-11-05T00:00:00Z',
 entities:[{id:'amr-1',kind:'amr',assetRef:asset},{id:'arm-1',kind:'arm',assetRef:{...asset,id:'arm-asset'}},{id:'coffee-1',kind:'coffee_machine',assetRef:{...asset,id:'coffee-asset'},recipeRefs:[{id:'latte',revision:1,hash}]}],
 world:{id:'world',revision:1,width:12,height:8,points:[{id:'kitchen',name:'Kitchen',kind:'kitchen',x:1,y:4},{id:'parking',name:'Parking',kind:'parking',x:1,y:1},{id:'table-1',name:'Table',kind:'table',x:5,y:2}],obstacles:[]}};
const runRequest={project:coffeeProject,scenarioId:'C01',scenarioRevision:1,seed:7,mode:'mock',backendSetId:'mock-default',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}};
const codes=(r:{ok:boolean;issues?:{code:string}[]})=>r.ok?[]:r.issues!.map(i=>i.code);

test('backend admission is server-catalog driven and never mixes mock with native backends',()=>{
 expect(admitBackend('mock',['valetudo_native'],catalog)).toEqual({ok:false,reasonCodes:['MODE_BACKEND_MISMATCH']});
 expect(admitBackend('mock',['mock_amr','gazebo_nav2'],catalog)).toEqual({ok:false,reasonCodes:['MODE_BACKEND_MISMATCH']});
 expect(admitBackend('mock',['mock_amr','mock_coffee','mock_arm'],catalog)).toEqual({ok:true,reasonCodes:[]});
 expect(admitBackend('mock',[],catalog)).toEqual({ok:false,reasonCodes:['BACKEND_SET_EMPTY']});
 expect(admitBackend('mock',['made_up'],catalog)).toEqual({ok:false,reasonCodes:['BACKEND_UNKNOWN']});
 expect(admitBackend('mock',['mock_amr'],catalog,'shadow')).toEqual({ok:false,reasonCodes:['ACCESS_MODE_MISMATCH']});
 // Not installed means an explicit reason, never a silent fall back to mock.
 expect(admitBackend('simulation',['gazebo_nav2'],catalog)).toEqual({ok:false,reasonCodes:['BACKEND_NOT_INSTALLED','BACKEND_INCOMPATIBLE','BACKEND_UNREACHABLE']});
 expect(admitBackend('hardware',['valetudo_native'],catalog).reasonCodes).toContain('ACCESS_REQUIRED');
 expect(admitBackend('hardware',['valetudo_native'],catalog,'live').ok).toBe(false);
 expect(admitBackend('hardware',['cell_native'],catalog,'shadow')).toEqual({ok:false,reasonCodes:['ACCESS_MODE_MISMATCH']});
 expect(admitBackend('hardware',['valetudo_native'],catalog,'shadow').reasonCodes).not.toContain('ACCESS_MODE_MISMATCH');
});

test('project v2 admission rejects endpoint, actor and v1 shapes with structured issues',()=>{
 const good=validateProjectV2(coffeeProject);expect(good.ok).toBe(true);
 expect(validateProjectV2({...coffeeProject,endpoint:'http://device'}).ok).toBe(false);
 expect(codes(validateProjectV2({...coffeeProject,endpoint:'http://device'}))).toEqual(['ENDPOINT_FORBIDDEN']);
 expect(codes(validateProjectV2({...coffeeProject,actorRef:'admin'}))).toEqual(['ACTOR_FORBIDDEN']);
 expect(codes(validateProjectV2({...coffeeProject,entities:[{...coffeeProject.entities[0],controllerUrl:'tcp://10.0.0.1'}]}))).toEqual(['ENDPOINT_FORBIDDEN']);
 const nested=validateProjectV2({...coffeeProject,entities:[{...coffeeProject.entities[0],hostname:'robot.local'}]});
 expect(nested.ok?[]:nested.issues[0]!.path).toBe('/entities/0');
 expect(validateProjectV2({...coffeeProject,schemaVersion:1}).ok).toBe(false);
 expect(validateProjectV2('nope').ok).toBe(false);
});

test('run request carries no role, endpoint or actor and has strict mode/access enums',()=>{
 expect(validateRunRequestV2(runRequest).ok).toBe(true);
 expect(codes(validateRunRequestV2({...runRequest,actorRef:'u1'}))).toEqual(['ACTOR_FORBIDDEN']);
 expect(codes(validateRunRequestV2({...runRequest,role:'admin'}))).toEqual(['ACTOR_FORBIDDEN']);
 expect(codes(validateRunRequestV2({...runRequest,endpoint:'http://robot'}))).toEqual(['ENDPOINT_FORBIDDEN']);
 expect(validateRunRequestV2({...runRequest,mode:'business_sim'}).ok).toBe(false);
 expect(validateRunRequestV2({...runRequest,project:{...coffeeProject,endpoint:'http://x'}}).ok).toBe(false);
});

test('actions are an allowlist: no actor, mode update, raw G-code or endpoint reaches a backend',()=>{
 const base={actionId:'a1',expectedRevision:0};
 for(const a of [{kind:'start',payload:{}},{kind:'step',payload:{ticks:5}},{kind:'confirm',payload:{subjectId:'cup-1',confirmationType:'handoff'}},{kind:'injectFault',payload:{faultId:'ice_jam'}},{kind:'reconcile',payload:{subjectId:'job-1'}}])expect(validateActionV2({...base,...a}).ok).toBe(true);
 expect(codes(validateActionV2({...base,kind:'start',payload:{},actorRef:'u1'}))).toEqual(['ACTOR_FORBIDDEN']);
 for(const kind of ['setMode','setBackend','setAccess','updateMode'])expect(codes(validateActionV2({...base,kind,payload:{mode:'hardware'}}))).toEqual(['MODE_IMMUTABLE']);
 expect(codes(validateActionV2({...base,kind:'start',payload:{mode:'hardware'}}))).toEqual(['MODE_IMMUTABLE']);
 expect(codes(validateActionV2({...base,kind:'runGcode',payload:{gcode:'G0 X1'}}))).toEqual(['ACTION_KIND_FORBIDDEN']);
 expect(validateActionV2({...base,kind:'confirm',payload:{subjectId:'cup-1'}}).ok).toBe(false);
 expect(codes(validateActionV2({...base,kind:'start',payload:{endpoint:'http://x'}}))).toEqual(['ENDPOINT_FORBIDDEN']);
});

const payload={jobId:'job-1'};
const command:CellCommand={commandId:'c1',runId:'11111111-1111-4111-8111-111111111111',deviceId:'arm-1',controlEpoch:3,expiresAt:'2026-11-05T00:01:00Z',recipeRevision:1,programRef:{id:'pick-cup',hash},capability:'start_job',payloadHash:hashPayload(payload),payload};
test('cell command envelope is typed per capability and bound to its payload hash',()=>{
 expect(validateCellCommand(command).ok).toBe(true);
 expect(codes(validateCellCommand({...command,payloadHash:hash}))).toEqual(['PAYLOAD_HASH_MISMATCH']);
 expect(codes(validateCellCommand({...command,actorRef:'u'}))).toEqual(['ACTOR_FORBIDDEN']);
 expect(validateCellCommand({...command,capability:'jog'}).ok).toBe(false);
 const gcode={gcode:'G0 X1'};expect(validateCellCommand({...command,capability:'start_job',payload:gcode,payloadHash:hashPayload(gcode)}).ok).toBe(false);
 const wrong={profileId:'p'};expect(validateCellCommand({...command,capability:'start_job',payload:wrong,payloadHash:hashPayload(wrong)}).ok).toBe(false);
 const brew={recipeId:'latte',cupId:'cup-1'};expect(validateCellCommand({...command,capability:'brew',payload:brew,payloadHash:hashPayload(brew)}).ok).toBe(true);
 expect(validateCellCommand({...command,controlEpoch:0}).ok).toBe(false);
 expect(validateCellCommand({...command,programRef:undefined}).ok).toBe(false);
});

test('cell observation must echo the command identity and carry bootId, seq and result',()=>{
 const obs:CellObservation={schemaVersion:2,commandId:'c1',deviceId:'arm-1',controlEpoch:3,payloadHash:command.payloadHash,bootId:'boot-1',seq:'12',result:'accepted',observedAt:null,reasonCodes:[]};
 expect(validateCellObservation(obs).ok).toBe(true);
 expect(matchObservation(command,obs)).toEqual({ok:true,reasonCodes:[]});
 expect(matchObservation(command,{...obs,controlEpoch:2})).toEqual({ok:false,reasonCodes:['OBSERVATION_IDENTITY_MISMATCH']});
 expect(matchObservation(command,{...obs,deviceId:'arm-2',commandId:'c2'}).reasonCodes).toEqual(['OBSERVATION_IDENTITY_MISMATCH']);
 expect(validateCellObservation({...obs,result:'done'}).ok).toBe(false);
 expect(validateCellObservation({...obs,seq:12}).ok).toBe(false);
});

test('twin samples keep unknown as null with a reason and reject stale-without-reason',()=>{
 const sample={schemaVersion:2,runId:command.runId,entityId:'arm-1',providerId:'mock',bootId:'b1',seq:'1',simTimeNs:'0',observedAt:null,receivedMonotonicNs:'5',frameId:'arm_base',origin:'mock',quality:'valid',reasonCodes:[],commanded:null,observed:{jointsRad:[0,0,0,0,0,0]},estimated:null,causationId:null};
 expect(validateTwinSampleV2(sample).ok).toBe(true);
 expect(validateTwinSampleV2({...sample,quality:'unknown',observed:null}).ok).toBe(false);
 expect(validateTwinSampleV2({...sample,quality:'unknown',observed:null,reasonCodes:['NO_FEEDBACK']}).ok).toBe(true);
 expect(validateTwinSampleV2({...sample,origin:'gazebo'}).ok).toBe(false);
 expect(validateTwinSampleV2({...sample,seq:1}).ok).toBe(false);
});

test('twin sample states are finite per entity kind, SI units in the field name, no open maps',()=>{
 const base={schemaVersion:2,runId:command.runId,entityId:'amr-1',providerId:'mock_amr',bootId:'b1',seq:'7',simTimeNs:'140000000',observedAt:null,receivedMonotonicNs:'5',frameId:'map',origin:'mock',quality:'valid',reasonCodes:[],estimated:null,causationId:null};
 const ok=(s:object)=>validateTwinSampleV2({...base,...s}).ok;
 expect(ok({commanded:{goalCommandId:'cmd-1',goalState:'executing'},observed:{xM:1,yM:2,yawRad:0.5,moving:true,hold:null}})).toBe(true);
 expect(ok({commanded:null,observed:{xM:1,yM:2,yawRad:0,extra:1}})).toBe(false); // unknown field
 expect(ok({commanded:null,observed:{x:1,y:2,yaw:0}})).toBe(false); // unitless names
 expect(ok({commanded:null,observed:{xM:'1',yM:2,yawRad:0}})).toBe(false);
 expect(ok({commanded:{jointsRad:[0,0,0,0,0,0],gripper:'open'},observed:null,quality:'unknown',reasonCodes:['NO_ENCODER_MOCK'],frameId:'arm_base'})).toBe(true);
 expect(ok({commanded:{jointsRad:[0,0,0]},observed:null,quality:'unknown',reasonCodes:['NO_ENCODER_MOCK']})).toBe(false); // six joints
 expect(ok({observed:{cycleState:'brew',cupPresent:true,machineStatus:'ready'},commanded:null,frameId:'cell_base'})).toBe(true);
 expect(ok({observed:{cupPresent:null,cycleState:'idle'},commanded:null,frameId:'cell_base'})).toBe(true);
 expect(ok({observed:{ownerKind:'robot',ownerId:'amr-1'},commanded:null})).toBe(true);
 expect(ok({observed:{ownerKind:'teleport',ownerId:'amr-1'},commanded:null})).toBe(false);
});

test('asset revisions refer to bundle content by hash only and vendor CAD needs a license',()=>{
 const rev={schemaVersion:2,id:'arm-asset',revision:1,contentHash:hash,hashAlgorithm:'sha256-canonical-json-v1',kind:'arm',visual:null,collision:{contentHash:hash,mediaType:'model/gltf-binary'},frames:[{id:'world',parentId:null,translationM:[0,0,0],quaternionXyzw:[0,0,0,1]}],geometry:[{kind:'box',frameId:'world',sizeM:[1,1,1]}],provenance:[{parameter:'geometry',source:'illustrative'}]};
 expect(validateAssetRevision(rev).ok).toBe(true);
 expect(validateAssetRevision({...rev,visual:{contentHash:'http://evil/x.glb',mediaType:'model/gltf-binary'}}).ok).toBe(false);
 expect(validateAssetRevision({...rev,collision:{contentHash:hash,mediaType:'model/gltf-binary',uri:'../../etc/passwd'}}).ok).toBe(false);
 expect(validateAssetRevision({...rev,provenance:[{parameter:'mesh',source:'vendor_cad'}]}).ok).toBe(false);
 expect(validateAssetRevision({...rev,provenance:[{parameter:'mesh',source:'vendor_cad',license:'vendor-eula'}]}).ok).toBe(true);
});

test('coffee recipes use exact decimal strings and never allow automatic retry',()=>{
 const q={amount:'18.5',tolerance:'0.5',unit:'kg',provenance:'illustrative'};
 const recipe={schemaVersion:2,id:'latte',revision:1,hash,outputType:'latte',cupType:'paper-12oz',steps:[{id:'s1',kind:'brew',target:q,requires:['machine-1'],timeoutMs:60000}],resources:[{resourceId:'beans',kind:'coffee_beans',requiredAmount:q}],recovery:{onTimeout:'hold_and_reconcile',autoRetry:false}};
 expect(validateCoffeeRecipe(recipe).ok).toBe(true);
 expect(validateCoffeeRecipe({...recipe,recovery:{...recipe.recovery,autoRetry:true}}).ok).toBe(false);
 expect(validateCoffeeRecipe({...recipe,steps:[{...recipe.steps[0],target:{...q,amount:18.5}}]}).ok).toBe(false);
 expect(validateCoffeeRecipe({...recipe,script:'brew()'}).ok).toBe(false);
});

test('evidence records only allow the four spec results',()=>{
 const ev={schemaVersion:2,id:'ev1',requirementIds:['CORE-03'],scenarioId:null,runId:null,inputsManifest:{projectHash:hash,sourceCommit:'c',schemaHash:hash,seed:1,mode:'mock',access:'simulated',backends:['mock_amr']},result:'pass',assertions:[{id:'a',passed:true}],artifacts:[{name:'r.json',sha256:hash}],actualFidelity:'modeled',signer:null};
 expect(validateEvidenceV2(ev).ok).toBe(true);
 for(const result of ['blocked_external','fail','not_run'])expect(validateEvidenceV2({...ev,result}).ok).toBe(true);
 expect(validateEvidenceV2({...ev,result:'verified_local'}).ok).toBe(false);
});

test('v1 schemas keep their exact bytes and v1 project fixtures still validate',async()=>{
 const expected:Record<string,string>={'lab-project':'d6dda9f63e3ded3421004444a64a32cb0b7d4ccf1e139901ebc76c8e021a97ea','lab-run':'f2063867b11ee8e144cfe9f0785cb39fc5622e3dc2c9f060780fba851d139059','lab-deployment':'12d180b9c8c4dca598fd8711d1ecde913674726c86535871b4a8e7d9e4e98679'};
 for(const [name,sha] of Object.entries(expected))expect(createHash('sha256').update(await readFile(`packages/contracts/schemas/${name}.schema.json`)).digest('hex')).toBe(sha);
 const v1={schemaVersion:1,id:'p1',name:'R',revision:1,updatedAt:'2026-11-01T00:00:00Z',design:{id:'robot',revision:1,chassis:'service',trays:2,batteryAh:20,sensor:'lidar',payloadKg:10},world:coffeeProject.world};
 expect(()=>validateProject(v1)).not.toThrow();
 expect(()=>validateProject(coffeeProject)).toThrow('INVALID_PROJECT');
 const ids=['lab-project-v2','lab-run-v2','lab-action-v2','twin-sample-v2','asset-revision','coffee-recipe','cell-command','cell-observation','lab-evidence-v2'];
 for(const n of ids)expect(JSON.parse(await readFile(`packages/contracts/schemas/${n}.schema.json`,'utf8')).$id).toMatch(/^mekoniq\.[a-z-]+\.v2$/);
});

// ---- gateway v2 ----
const instances:LabGateway[]=[],dirs:string[]=[];
afterEach(async()=>{for(const g of instances.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{force:true,recursive:true});});
const origin='http://127.0.0.1:4175';
async function setup(){const directory=await mkdtemp(join(tmpdir(),'lab-v2-'));dirs.push(directory);const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash});instances.push(g);return {g,directory};}
const post=(url:string,headers:Record<string,string>,body:unknown)=>fetch(url,{method:'POST',headers,body:JSON.stringify(body)});
async function pairV2(g:LabGateway,body:unknown={token:g.pairingToken}){const r=await post(g.url+'/lab/v2/sessions',{Origin:origin,'Content-Type':'application/json'},body);return r;}
async function headersV2(g:LabGateway){const r=await pairV2(g);expect(r.status).toBe(201);const {csrfToken}=await r.json() as {csrfToken:string};return {Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':csrfToken};}
const run=(over={})=>({...runRequest,scenarioId:'FD01',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash},...over});

test('v2 health advertises both protocol majors and backend states without credentials',async()=>{
 const {g}=await setup();const health=await (await fetch(g.url+'/lab/v2/health')).json() as {protocolMajor:number;protocolMajors:number[];backends:{id:string;enabled:boolean;installed:boolean;compatible:boolean;reachable:boolean;commissioned:boolean}[]};
 expect(health.protocolMajor).toBe(2);expect(health.protocolMajors).toEqual([1,2]);
 expect(health.backends.map(b=>b.id)).toEqual(expect.arrayContaining(['mock_amr','mock_coffee','mock_arm','gazebo_nav2','valetudo_native']));
 expect(health.backends.every(b=>b.enabled===false)).toBe(true);
 expect(JSON.stringify(health)).not.toMatch(/endpoint|token|secret|password|https?:/i);
 const v1=await (await fetch(g.url+'/lab/v1/health')).json() as {protocolMajor:number;protocolMajors?:number[]};expect(v1.protocolMajor).toBe(1);expect(v1.protocolMajors).toBeUndefined();
});

test('v2 pairing uses its own cookie path, shares the one-use token and rejects caller-chosen roles',async()=>{
 const {g}=await setup();
 const rejected=await pairV2(g,{token:g.pairingToken,role:'admin'});expect(rejected.status).toBe(422);expect((await rejected.json() as {reasonCodes:string[]}).reasonCodes).toEqual(['ACTOR_FORBIDDEN']);
 const paired=await pairV2(g);expect(paired.status).toBe(201);
 const cookie=paired.headers.get('set-cookie')!;expect(cookie).toContain('Path=/lab/v2');expect(cookie).toContain('HttpOnly');expect(cookie).not.toContain('mekoniq_lab_session=');
 const body=await paired.json() as {csrfToken:string;principal:{controlOwner:string}};expect(body.principal.controlOwner).toBe('lab_simulation');
 expect((await pairV2(g)).status).toBe(401);
 expect((await post(g.url+'/lab/v1/sessions',{Origin:origin,'Content-Type':'application/json'},{token:g.pairingToken})).status).toBe(401);
});

test('v1 and v2 sessions do not authenticate each other and v2 enforces CSRF and origin',async()=>{
 const {g}=await setup();const h2=await headersV2(g);
 expect((await fetch(g.url+'/lab/v2/runs/11111111-1111-4111-8111-111111111111',{headers:{Origin:origin}})).status).toBe(401);
 const g2=await setup();
 const r1=await post(g2.g.url+'/lab/v1/sessions',{Origin:origin,'Content-Type':'application/json'},{token:g2.g.pairingToken});const h1={Origin:origin,'Content-Type':'application/json',Cookie:r1.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':(await r1.json() as {csrfToken:string}).csrfToken};
 expect((await post(g2.g.url+'/lab/v2/projects/validate',h1,coffeeProject)).status).toBe(401);
 expect((await post(g.url+'/lab/v2/projects/validate',{...h2,'X-CSRF-Token':'wrong'},coffeeProject)).status).toBe(403);
 const noOrigin:Record<string,string>={...h2};delete noOrigin.Origin;expect((await post(g.url+'/lab/v2/projects/validate',noOrigin,coffeeProject)).status).toBe(403);
 expect((await fetch(g.url+'/lab/v2/projects/validate',{headers:h2})).status).toBe(405);
 expect((await fetch(g.url+'/lab/v2/nope',{headers:h2})).status).toBe(404);
});

test('project validation route reports field issues and never applies anything',async()=>{
 const {g}=await setup(),h=await headersV2(g);
 const ok=await post(g.url+'/lab/v2/projects/validate',h,coffeeProject);expect(ok.status).toBe(200);expect(await ok.json()).toEqual({ok:true});
 const bad=await post(g.url+'/lab/v2/projects/validate',h,{...coffeeProject,endpoint:'http://device'});expect(bad.status).toBe(422);
 expect(await bad.json()).toMatchObject({error:'INVALID_PROJECT',reasonCodes:['ENDPOINT_FORBIDDEN'],issues:[{code:'ENDPOINT_FORBIDDEN',path:''}]});
});

test('server denies capability before any run or backend exists',async()=>{
 const {g,directory}=await setup(),h=await headersV2(g),url=g.url+'/lab/v2/runs';
 const denied=async(body:unknown,status:number,codesWanted:string[])=>{const r=await post(url,h,body);expect(r.status).toBe(status);expect((await r.json() as {reasonCodes:string[]}).reasonCodes).toEqual(codesWanted);};
 await denied(run({mode:'hardware',access:'live',backendSetId:'hardware-live'}),403,['ACCESS_NOT_GRANTED']);
 await denied(run({mode:'hardware',access:'hil',backendSetId:'hardware-hil'}),403,['ACCESS_NOT_GRANTED']);
 // A granted access cannot carry a more privileged server-owned set.
 for(const backendSetId of ['hardware-live','hardware-hil'])await denied(run({mode:'hardware',access:'shadow',backendSetId}),422,['ACCESS_MODE_MISMATCH']);
 await denied(run({mode:'hardware',access:'simulated',backendSetId:'hardware-shadow'}),422,['ACCESS_MODE_MISMATCH']);
 await denied(run({backendSetId:'does-not-exist'}),422,['BACKEND_SET_UNKNOWN']);
 await denied(run({mode:'simulation',backendSetId:'mock-default'}),422,['MODE_BACKEND_MISMATCH']);
 await denied(run({mode:'simulation',access:'simulated',backendSetId:'simulation-default'}),422,['BACKEND_NOT_INSTALLED','BACKEND_INCOMPATIBLE','BACKEND_UNREACHABLE']);
 await denied(run({mode:'hardware',access:'shadow',backendSetId:'hardware-shadow'}),422,['BACKEND_NOT_INSTALLED','BACKEND_INCOMPATIBLE','BACKEND_UNREACHABLE','BACKEND_NOT_COMMISSIONED']);
 await denied(run({actorRef:'u1'}),422,['ACTOR_FORBIDDEN']);
 await denied(run({runtimeIdentity:{sourceCommit:'other',schemaHash:hash}}),409,['CONTRACT_MISMATCH']);
 // An admissible mock set still starts nothing while only the schema exists.
 await denied(run(),501,['BACKEND_EXECUTION_DISABLED']);
 expect(await readdir(directory)).toEqual([]);
});

test('v2 action and read routes validate then deny without a run; mode change is immutable',async()=>{
 const {g}=await setup(),h=await headersV2(g),id='11111111-1111-4111-8111-111111111111',base={actionId:'a1',expectedRevision:0};
 const act=(b:unknown)=>post(`${g.url}/lab/v2/runs/${id}/actions`,h,b);
 let r=await act({...base,kind:'setMode',payload:{mode:'hardware'}});expect(r.status).toBe(422);expect((await r.json() as {reasonCodes:string[]}).reasonCodes).toEqual(['MODE_IMMUTABLE']);
 r=await act({...base,kind:'start',payload:{},actorRef:'u1'});expect(r.status).toBe(422);expect((await r.json() as {reasonCodes:string[]}).reasonCodes).toEqual(['ACTOR_FORBIDDEN']);
 expect((await act({...base,kind:'start',payload:{}})).status).toBe(404);
 for(const p of ['','/report','/events','/telemetry'])expect((await fetch(`${g.url}/lab/v2/runs/${id}${p}`,{headers:h})).status).toBe(404);
 expect((await post(`${g.url}/lab/v2/runs/${id}/reclaim`,h,{proof:'unknown-run-proof'})).status).toBe(404);
 expect((await fetch(`${g.url}/lab/v2/runs/${id}/actions`,{headers:h})).status).toBe(405);
});

test('a shadow grant cannot carry a hil/live set even when every backend is provisioned and lists shadow',async()=>{
 const provisioned:CapabilityCatalog={backends:defaultCatalog.backends.map(b=>({...b,installed:true,compatible:true,reachable:true,commissioned:true})),sets:{...defaultCatalog.sets,'amr-live':{mode:'hardware',access:'live',backends:['valetudo_native']},'amr-hil':{mode:'hardware',access:'hil',backends:['valetudo_native']}}};
 const directory=await mkdtemp(join(tmpdir(),'lab-v2-'));dirs.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:hash,v2:{catalog:provisioned,enabledBackends:['valetudo_native']}});instances.push(g);
 const h=await headersV2(g);
 for(const backendSetId of ['amr-live','amr-hil','hardware-live']){
  const r=await post(g.url+'/lab/v2/runs',h,run({mode:'hardware',access:'shadow',backendSetId}));
  expect(r.status).toBe(422);expect((await r.json() as {reasonCodes:string[]}).reasonCodes).toEqual(['ACCESS_MODE_MISMATCH']);
 }
 expect(await readdir(directory)).toEqual([]);
});
