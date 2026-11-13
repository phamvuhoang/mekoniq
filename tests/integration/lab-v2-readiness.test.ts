import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {restaurant} from '../support/lab-v2';
const roots:string[]=[],gateways:LabGateway[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of roots.splice(0))await rm(d,{recursive:true,force:true});});
async function gateway(enabledBackends=['mock_amr','mock_coffee','mock_arm']){
 const directory=await mkdtemp(join(tmpdir(),'lab-readiness-'));roots.push(directory);
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{enabledBackends}});gateways.push(g);
 const pair=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});
 const cookie=pair.headers.get('set-cookie')!.split(';')[0]!,csrf=(await pair.json()).csrfToken as string;
 return {g,directory,cookie,csrf};
}
test('readiness requires pairing and rejects arbitrary probe parameters',async()=>{
 const {g,cookie}=await gateway();
 const url=g.url+'/lab/v2/readiness?scenarioId=BV01&backendSetId=mock-default';
 expect((await fetch(url)).status).toBe(401);
 expect((await fetch(url+'&command=uname',{headers:{cookie}})).status).toBe(400);
 expect((await fetch(url+'&scenarioId=FD01',{headers:{cookie}})).status).toBe(400);
});
test('server readiness checks only required backends and reports a bounded expiry',async()=>{
 const {g,cookie}=await gateway(['mock_amr']);
 const r=await fetch(g.url+'/lab/v2/readiness?scenarioId=FD01&backendSetId=mock-default',{headers:{cookie}});
 expect(r.status).toBe(200);const body=await r.json();
 expect(body.canStart).toBe(true);
 expect(body.checks.filter((c:{id:string})=>c.id.startsWith('backend:')).map((c:{id:string})=>c.id)).toEqual(['backend:mock_amr']);
 expect(Date.parse(body.expiresAt)-Date.parse(body.checkedAt)).toBe(30000);
});
test('native backend names never hide the missing runner and gripper evidence',async()=>{
 const {g,cookie}=await gateway();
 const r=await fetch(g.url+'/lab/v2/readiness?scenarioId=BV01&backendSetId=coffee-simulation',{headers:{cookie}});
 expect(r.status).toBe(200);const body=await r.json();
 expect(body.canStart).toBe(false);
 expect(body.checks.flatMap((c:{reasonCodes:string[]})=>c.reasonCodes)).toEqual(expect.arrayContaining(['BACKEND_NOT_INSTALLED:linuxcnc_sim','NATIVE_RUNNER_UNAVAILABLE','GRIP_PROVIDER_UNAVAILABLE']));
});
test('create rechecks availability before creating any run journal',async()=>{
 const {g,cookie,csrf,directory}=await gateway([]);
 const before=await readdir(directory);
 const r=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});
 expect(r.status).not.toBe(201);expect(await readdir(directory)).toEqual(before);
 expect(defaultCatalog.sets['mock-amr']!.backends).toEqual(['mock_amr']);
});
test('an available scenario can start without unrelated backends in its set',async()=>{
 const {g,cookie,csrf}=await gateway(['mock_amr']);
 const r=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-default',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});
 expect(r.status).toBe(201);
 const body=await r.json();expect(body.run.backends).toEqual(['mock_amr']);
});
test('a readiness probe failure at create is rechecked and leaves no journal',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-probe-'));roots.push(directory);let available=true;
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{enabledBackends:['mock_amr'],readinessProbes:{world:async()=>({status:available?'ready':'blocked',reasonCodes:available?[]:['WORLD_REVISION_MISMATCH'],evidenceRef:null})}}});gateways.push(g);
 const paired=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});const cookie=paired.headers.get('set-cookie')!.split(';')[0]!,csrf=(await paired.json()).csrfToken as string;
 expect((await (await fetch(g.url+'/lab/v2/readiness?scenarioId=FD01&backendSetId=mock-amr',{headers:{cookie}})).json()).canStart).toBe(true);
 available=false;
 const r=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});
 expect(r.status).toBe(422);expect((await r.json()).reasonCodes).toContain('WORLD_REVISION_MISMATCH');expect(await readdir(directory)).toEqual([]);
});
test('native readiness explains actual host, model, clock and fixture dependencies without injected probes',async()=>{
 const {g,cookie}=await gateway();const snapshot=await (await fetch(g.url+'/lab/v2/readiness?scenarioId=BV01&backendSetId=coffee-simulation',{headers:{cookie}})).json();
 expect(snapshot.checks.map((c:{id:string})=>c.id)).toEqual(expect.arrayContaining(['host','protocol','model','clock','fixture']));
 expect(snapshot.canStart).toBe(false);
});
test('starting a previously created ready run rechecks probes and leaves it ready if blocked',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-start-probe-'));roots.push(directory);let available=true;
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{enabledBackends:['mock_amr'],readinessProbes:{world:async()=>({status:available?'ready':'blocked',reasonCodes:available?[]:['WORLD_REVISION_MISMATCH'],evidenceRef:null})}}});gateways.push(g);
 const pair=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});const cookie=pair.headers.get('set-cookie')!.split(';')[0]!,csrf=(await pair.json()).csrfToken as string;
 const headers={cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':csrf};
 const created=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers,body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});expect(created.status).toBe(201);const view=await created.json();
 available=false;const started=await fetch(g.url+`/lab/v2/runs/${view.run.id}/actions`,{method:'POST',headers,body:JSON.stringify({actionId:'start-1',expectedRevision:view.run.runRevision,kind:'start',payload:{}})});
 expect(started.status).toBe(422);expect((await started.json()).reasonCodes).toContain('WORLD_REVISION_MISMATCH');
 expect((await (await fetch(g.url+`/lab/v2/runs/${view.run.id}`,{headers:{cookie}})).json()).run).toMatchObject({status:'ready',eventCursor:view.run.eventCursor});
});
test('project readiness is CSRF protected and validates the caller world before any allocation',async()=>{
 const {g,cookie,csrf,directory}=await gateway();
 const body=JSON.stringify({scenarioId:'BV01',backendSetId:'mock-default',project:restaurant()});
 const headers={cookie,origin:'http://127.0.0.1:4175','content-type':'application/json'};
 expect((await fetch(g.url+'/lab/v2/readiness',{method:'POST',headers,body})).status).toBe(403);
 const response=await fetch(g.url+'/lab/v2/readiness',{method:'POST',headers:{...headers,'x-csrf-token':csrf},body});expect(response.status).toBe(200);
 const snapshot=await response.json();expect(snapshot.canStart).toBe(false);expect(snapshot.checks.find((c:{id:string})=>c.id==='world').status).toBe('blocked');expect(await readdir(directory)).toEqual([]);
});
test.each(['start','resume'] as const)('an accepted %s replays its receipt after readiness becomes blocked',async kind=>{
 const directory=await mkdtemp(join(tmpdir(),'lab-retry-probe-'));roots.push(directory);let available=true;
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),v2:{enabledBackends:['mock_amr'],readinessProbes:{world:async()=>({status:available?'ready':'blocked',reasonCodes:available?[]:['WORLD_REVISION_MISMATCH'],evidenceRef:null})}}});gateways.push(g);
 const pair=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.pairingToken})});const cookie=pair.headers.get('set-cookie')!.split(';')[0]!,csrf=(await pair.json()).csrfToken as string;
 const headers={cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':csrf};
 const created=await fetch(g.url+'/lab/v2/runs',{method:'POST',headers,body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});expect(created.status).toBe(201);let view=await created.json();
 const url=g.url+`/lab/v2/runs/${view.run.id}`,post=(body:unknown)=>fetch(url+'/actions',{method:'POST',headers,body:JSON.stringify(body)});
 if(kind==='resume'){
  view=await (await post({actionId:'initial-start',expectedRevision:view.run.runRevision,kind:'start',payload:{}})).json();
  view=await (await post({actionId:'initial-pause',expectedRevision:view.run.runRevision,kind:'pause',payload:{}})).json();
 }
 const action={actionId:'accepted-action',expectedRevision:view.run.runRevision,kind,payload:{}};
 const accepted=await post(action);expect(accepted.status).toBe(200);const receipt=await accepted.json();
 const paused=await post({actionId:'pause-after-success',expectedRevision:receipt.run.runRevision,kind:'pause',payload:{}});expect(paused.status).toBe(200);const current=await paused.json();
 available=false;
 const retried=await post(action);expect(retried.status).toBe(200);expect(await retried.json()).toEqual(receipt);
 const conflict=await post({...action,expectedRevision:current.run.runRevision});expect(conflict.status).toBe(409);expect((await conflict.json()).error).toBe('ACTION_CONFLICT');
 const fresh=await post({actionId:'new-resume',expectedRevision:current.run.runRevision,kind:'resume',payload:{}});expect(fresh.status).toBe(422);expect((await fresh.json()).reasonCodes).toContain('WORLD_REVISION_MISMATCH');
 const after=await (await fetch(url,{headers:{cookie}})).json();expect(after.run).toEqual(current.run);
});

test('runs of an expired session are closed before readiness: a slot held by such a run never refuses a later create',async()=>{
 // the probe stands for a single-slot provider (MuJoCo, the Webots arm): blocked while any run is open
 const directory=await mkdtemp(join(tmpdir(),'lab-sweep-'));roots.push(directory);let now=1_000_000;
 const probeDir=await mkdtemp(join(tmpdir(),'lab-sweep-proto-'));roots.push(probeDir);
 const probeRun=await createScenarioRun({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:1,mode:'mock',access:'simulated',backendSetId:'mock-amr',sourceCommit:'test-commit'} as never,{directory:probeDir,enabledBackends:['mock_amr']} as never),proto=Object.getPrototypeOf(probeRun);await probeRun.close();
 const open=new Set<object>(),snapshot=proto.snapshot,close=proto.close;
 const spies=[vi.spyOn(proto,'snapshot').mockImplementation(function(this:object,...a:unknown[]){open.add(this);return snapshot.apply(this,a);}),
  vi.spyOn(proto,'close').mockImplementation(function(this:object,...a:unknown[]){open.delete(this);return close.apply(this,a);})];
 try{
  const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash:'a'.repeat(64),nowMs:()=>now,v2:{enabledBackends:['mock_amr'],readinessProbes:{slot:async()=>({status:open.size?'blocked':'ready',reasonCodes:open.size?['SLOT_BUSY']:[],evidenceRef:null})}}});gateways.push(g);
  const pair=async()=>{const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin:'http://127.0.0.1:4175','content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});return {cookie:r.headers.get('set-cookie')!.split(';')[0]!,csrf:(await r.json()).csrfToken as string};};
  const create=(s:{cookie:string;csrf:string})=>fetch(g.url+'/lab/v2/runs',{method:'POST',headers:{cookie:s.cookie,origin:'http://127.0.0.1:4175','content-type':'application/json','x-csrf-token':s.csrf},body:JSON.stringify({project:restaurant(),scenarioId:'FD01',scenarioRevision:1,seed:17,mode:'mock',access:'simulated',backendSetId:'mock-amr',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:'a'.repeat(64)}})});
  const a=await pair();expect((await create(a)).status).toBe(201);expect(open.size).toBe(1);
  const b=await pair();const busy=await create(b);expect(busy.status).toBe(422);expect((await busy.json()).reasonCodes).toContain('SLOT_BUSY'); // a live session keeps its run
  now+=3_600_000;const c=await pair();
  expect((await create(c)).status).toBe(201);expect(open.size).toBe(1); // the expired session's run was closed first; the new run holds the slot
 }finally{for(const s of spies)s.mockRestore();}
});
