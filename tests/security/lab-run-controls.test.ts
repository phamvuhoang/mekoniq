// Handler/request objects and wall-clock barriers control scheduling; the fixed-step runner,
// Source journal and IR-SIM worker are real. This is authority/lifecycle coverage, not qualification.
import {afterAll,afterEach,beforeAll,expect,test} from 'vitest';
import {rm} from 'node:fs/promises';
import {startLabGateway} from '../../packages/lab-runtime/src/gateway';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createV2Gateway} from '../../packages/lab-runtime/src/v2/gateway';
import {createIRSimScenarioRun} from '../../packages/lab-runtime/src/v2/navigation2d/runner';
import {portableCatalog} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import type {ScenarioRun,RunView} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {findReclaim} from '../../packages/lab-runtime/src/v2/reclaim-store';
import {irsimAvailable,irsimBundle,irsimProviders,removeBundles,temp} from '../support/irsim-mission';
const gate=()=>{let release!:()=>void;return {promise:new Promise<void>(r=>release=r),release:()=>release()};};
const turn=()=>new Promise<void>(r=>setImmediate(r));
const origin='http://127.0.0.1:4175',schemaHash='a'.repeat(64),IR='engineering-irsim-2d-v1';
let bundle:Awaited<ReturnType<typeof irsimBundle>>;
const cleanup:(()=>Promise<void>)[]=[];
beforeAll(async()=>{if(irsimAvailable)bundle=await irsimBundle();},120_000);
afterEach(async()=>{for(const close of cleanup.splice(0))await close();});
afterAll(removeBundles);
interface Reply {status:number;body:RunView&{sessionToken:string;sessionId:string;csrfToken:string;reclaimToken:string;error:string;writer:{controlEpoch:number;sessionId:string}}}
async function fixture(holdResult=false){
 const directory=await temp('priority-control-'),boundary=gate(),release=gate(),resultReady=gate(),resultRelease=gate();let now=1000,wall=0,run!:ScenarioRun,closes=0;
 const requests=new WeakMap<IncomingMessage,Record<string,unknown>>(),responses=new WeakMap<ServerResponse,Reply>();
 const g=createV2Gateway({directory,sourceCommit:'test-commit',schemaHash,now:()=>now,pairingValid:()=>true,spendPairing(){},same:(a,b)=>a===b,catalog:portableCatalog(true),enabledBackends:['irsim_2d'],engineering:bundle.service,
  portableChecks:async()=>['model','clock','fixture','profile','runner'].map(id=>({id,status:'ready' as const,reasonCodes:[],evidenceRef:'test-owned-worker'})),
  readBody:async r=>requests.get(r)!,send:(r,status,body)=>{responses.set(r,{status,body:body as Reply['body']});},
  simulationFactory:async(input,p)=>{run=await createIRSimScenarioRun(input,{...await irsimProviders(p.directory,bundle.service),wall:{now:()=>wall,sleep:async ms=>{boundary.release();await release.promise;wall+=ms;}}});const close=run.close.bind(run);run.close=async()=>{closes++;await close();};if(holdResult){const action=run.action.bind(run);run.action=async(a,before)=>{const v=await action(a,before);if((a as {kind:string}).kind==='step'){resultReady.release();await resultRelease.promise;}return v;};}return run;}});
 const pending:Promise<unknown>[]=[];
 const call=(path:string,body:Record<string,unknown>,token?:string,headers:Record<string,string>={},requestOrigin:string|null=origin)=>{
  const req={method:'POST',headers:{...token?{authorization:`Bearer ${token}`}:{},...headers}} as IncomingMessage,res={setHeader(){}} as unknown as ServerResponse;requests.set(req,body);
  const p=g(req,res,'/lab/v2'+path,requestOrigin??undefined).then(()=>responses.get(res)!);pending.push(p);return p;
 };
 cleanup.push(async()=>{release.release();resultRelease.release();await Promise.allSettled(pending);await g.close();await rm(directory,{recursive:true,force:true});});
 const pair=async()=>(await call('/sessions',{token:'pair'})).body,a=await pair(),b=await pair(),c=await pair();
 const compiled=await call('/engineering/compile',{project:bundle.locked.project},a.sessionToken);
 const ref=compiled.body as unknown as {bundleDigest:string;projectDigest:string};
 const made=await call('/runs',{scenarioId:'IR-FD01',scenarioRevision:1,seed:5,mode:'simulation',access:'simulated',backendSetId:IR,runtimeIdentity:{sourceCommit:'test-commit',schemaHash},engineeringRef:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest}},a.sessionToken);
 expect(made.status,JSON.stringify(made.body)).toBe(201);const path=`/runs/${made.body.run.id}`;
 const act=(kind:string,revision:number,who=a,extra:Record<string,string>={},actionId=kind,payload:Record<string,unknown>={})=>call(path+'/actions',{actionId,expectedRevision:revision,kind,payload},who.sessionToken,extra);
 const started=await act('start',made.body.run.runRevision);expect(started.status).toBe(200);const rev=started.body.run.runRevision;
 const writer=(operation:string,who=a,recipient=b,epoch=0)=>call(path+'/writer',{operation,recipientSessionId:recipient.sessionId,controlEpoch:epoch},who.sessionToken);
 const batch=()=>act('step',rev,a,{},'batch',{ticks:20,pace:{factor:1}});
 return {g,run,call,act,a,b,c,pair,writer,batch,path,made,rev,boundary,release,resultReady,resultRelease,advance:(ms:number)=>{now+=ms;},directory,closes:()=>closes};
}
for(const kind of ['pause','cancel'])test.skipIf(!irsimAvailable)(`priority ${kind} crosses a held batch boundary while transfer keeps the reservation`,async()=>{
 const f=await fixture();expect((await f.writer('grant_read')).status).toBe(200);
 const batch=f.batch();await f.boundary.promise;expect(f.run.pulse().tick).toBe(1);
 let transferred=false;const transfer=f.writer('transfer').then(r=>{transferred=true;return r;});
 const control=f.act(kind,f.rev);await turn();expect(transferred).toBe(false);expect((await findReclaim(f.directory,f.run.id))!.record.controlEpoch??0).toBe(0);
 f.release.release();const [s,c,t]=await Promise.all([batch,control,transfer]);expect(c.status,JSON.stringify(c.body)).toBe(200);expect(s.status).toBe(200);
 expect(c.body.tick).toBe(1);expect(s.body.tick).toBe(c.body.tick);expect([c.body.run.runRevision,s.body.run.runRevision]).toEqual([f.rev+1,f.rev+2]);
 expect(t.status).toBe(200);expect(t.body.writer).toMatchObject({sessionId:f.b.sessionId,controlEpoch:1});expect((await findReclaim(f.directory,f.run.id))!.record.controlEpoch).toBe(1);
 expect((await f.act(kind,f.rev)).body.error).toBe('RUN_WRITER_CONFLICT');
 // Receipt replay remains available to the current writer, with no second mutation; changed payload/id remains a conflict.
 const retry=await f.act(kind,f.rev,f.b,{'x-lab-control-epoch':'1'});expect(retry.status).toBe(200);expect(retry.body.tick).toBe(c.body.tick);expect(retry.body.run).toEqual(c.body.run);
 expect((await f.act(kind,f.rev+2,f.b,{'x-lab-control-epoch':'1'})).body.error).toBe('ACTION_CONFLICT');
},120_000);

test.skipIf(!irsimAvailable)('priority admission refuses reader, stranger, stale epoch, CSRF and Origin before reaching the step queue',async()=>{
 const f=await fixture();await f.writer('grant_read');const batch=f.batch();await f.boundary.promise;
 const refusals=Promise.all([f.act('pause',f.rev,f.b),f.act('cancel',f.rev,f.c),f.act('pause',f.rev,f.a,{'x-lab-control-epoch':'1'}),
  f.call(f.path+'/actions',{actionId:'csrf',expectedRevision:f.rev,kind:'pause',payload:{}},undefined,{cookie:`mekoniq_lab_session_v2=${f.a.sessionToken}`}),
  f.call(f.path+'/actions',{actionId:'origin',expectedRevision:f.rev,kind:'pause',payload:{}},f.a.sessionToken,{},null)]);
 await turn();f.release.release();const rejected=await refusals;
 expect(rejected.map(r=>r.status)).toEqual([409,404,409,403,403]);expect(rejected.map(r=>r.body.error)).toEqual(['RUN_WRITER_CONFLICT','RUN_NOT_FOUND','RUN_WRITER_CONFLICT','CSRF_INVALID','ORIGIN_REQUIRED']);
 f.release.release();expect((await batch).body.tick).toBe(20);expect(f.run.pulse().paused).toBe(false);
},120_000);

test.skipIf(!irsimAvailable)('priority control rechecks session expiry at execution and expiry cleanup waits for the batch',async()=>{
 const f=await fixture(),batch=f.batch();await f.boundary.promise;const pause=f.act('pause',f.rev);await turn();f.advance(3600001);const fresh=await f.pair();
 const compiled=await f.call('/engineering/compile',{project:bundle.locked.project},fresh.sessionToken),ref=compiled.body as unknown as {bundleDigest:string;projectDigest:string};
 const expiry=f.call('/readiness',{scenarioId:'IR-FD01',backendSetId:IR,engineeringRef:{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest}},fresh.sessionToken);
 await turn();expect(f.closes()).toBe(0);f.release.release();const [s,p]=await Promise.all([batch,pause]);expect(s.status).toBe(200);expect(p.status).toBe(401);expect(p.body.error).toBe('SESSION_REQUIRED');expect(f.run.pulse().paused).toBe(false);expect(s.body.tick).toBe(20);await expiry;expect(f.closes()).toBe(1);
},120_000);

test.skipIf(!irsimAvailable)('direct fixed-step queue forwards the control execution callback and does not cache a refused pause',async()=>{
 const f=await fixture(),batch=f.batch();await f.boundary.promise;let allowed=true;
 const raw={actionId:'guarded-pause',expectedRevision:f.rev,kind:'pause',payload:{}};
 const control=f.run.action(raw,async()=>{if(!allowed)throw Error('SESSION_REQUIRED');}).then(v=>({view:v,error:null}),e=>({view:null,error:(e as Error).message}));
 allowed=false;f.release.release();const [s,c]=await Promise.all([batch,control]);expect(c.error).toBe('SESSION_REQUIRED');expect(f.run.pulse().paused).toBe(false);expect(s.body.tick).toBe(20);
 const retry=await f.run.action({...raw,expectedRevision:s.body.run.runRevision},async()=>{});expect(retry.run.status).toBe('paused');
},120_000);

for(const operation of ['reclaim','archive'])test.skipIf(!irsimAvailable)(`priority pause settles before ${operation} changes or closes the entry`,async()=>{
 const f=await fixture(),batch=f.batch();await f.boundary.promise;let finished=false;
 const lifecycle=f.call(f.path+'/'+operation,operation==='reclaim'?{proof:f.made.body.reclaimToken}:{},operation==='reclaim'?f.b.sessionToken:f.a.sessionToken).then(r=>{finished=true;return r;});
 const pause=f.act('pause',f.rev);await turn();expect(finished).toBe(false);expect(f.closes()).toBe(0);f.release.release();const [s,p,l]=await Promise.all([batch,pause,lifecycle]);
 expect(p.status,JSON.stringify(p.body)).toBe(200);expect(s.body.tick).toBe(p.body.tick);expect(l.status).toBe(200);
 if(operation==='reclaim'){expect(l.body.writer.controlEpoch).toBe(1);expect((await f.act('cancel',s.body.run.runRevision)).status).toBe(404);}else expect(f.closes()).toBe(1);
},120_000);

test.skipIf(!irsimAvailable)('a control arriving after runner batch completion waits for reservation release and keeps exact revision checks',async()=>{
 const f=await fixture(true),batch=f.batch();await f.boundary.promise;f.release.release();await f.resultReady.promise;
 let done=false;const pause=f.act('pause',f.rev+1).then(r=>{done=true;return r;});await turn();expect(done).toBe(false);expect(f.run.pulse().paused).toBe(false);
 f.resultRelease.release();expect((await batch).body.tick).toBe(20);expect((await pause).body.run.status).toBe('paused');
 expect((await f.act('cancel',f.rev)).body.error).toBe('REVISION_CONFLICT');
},120_000);

test.skipIf(!irsimAvailable)('a cached control queued inside a later step still needs current execution authority',async()=>{
 const f=await fixture(),paused=await f.act('pause',f.rev),resumed=await f.act('resume',paused.body.run.runRevision);
 const batch=f.run.action({actionId:'later-batch',expectedRevision:resumed.body.run.runRevision,kind:'step',payload:{ticks:2}});
 const retry=f.run.action({actionId:'pause',expectedRevision:f.rev,kind:'pause',payload:{}},async()=>{throw Error('SESSION_REQUIRED');}).then(()=>null,e=>(e as Error).message);
 expect(await retry).toBe('SESSION_REQUIRED');expect((await batch).tick).toBe(2);expect(f.run.pulse().paused).toBe(false);
},120_000);

test.skipIf(!irsimAvailable)('a stale revision control has no pause effect and does not truncate the admitted batch',async()=>{
 const f=await fixture(),batch=f.batch();await f.boundary.promise;const pause=f.act('pause',f.rev-1);await turn();f.release.release();
 expect((await pause).body.error).toBe('REVISION_CONFLICT');expect((await batch).body.tick).toBe(20);expect(f.run.pulse().paused).toBe(false);
},120_000);

test.skipIf(!irsimAvailable)('public close drains an admitted priority control and batch before closing the worker or releasing the data root',async()=>{
 const directory=await temp('priority-public-close-'),boundary=gate(),release=gate(),admitted=gate();let wall=0,workerClosed=false,run!:ScenarioRun;
 const g=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash,v2:{catalog:portableCatalog(true),enabledBackends:['irsim_2d'],engineering:bundle.service,
  portableChecks:async()=>['model','clock','fixture','profile','runner'].map(id=>({id,status:'ready' as const,reasonCodes:[],evidenceRef:'test-owned-worker'})),
  simulationFactory:async(input,p)=>{run=await createIRSimScenarioRun(input,{...await irsimProviders(p.directory,bundle.service),wall:{now:()=>wall,sleep:async ms=>{boundary.release();await release.promise;wall+=ms;}}});
   const control=run.controlDuringStep!.bind(run),close=run.close.bind(run);run.controlDuringStep=(a,before)=>{const p=control(a,before);if(p&&(a as {kind:string}).kind==='pause')admitted.release();return p;};run.close=async()=>{await close();workerClosed=true;};return run;}}});
 const requests:Promise<unknown>[]=[];
 cleanup.push(async()=>{release.release();await Promise.allSettled(requests);await g.close();await rm(directory,{recursive:true,force:true});});
 const post=(path:string,body:unknown,token?:string)=>{const p=fetch(g.url+'/lab/v2'+path,{method:'POST',headers:{origin,'content-type':'application/json',...token?{authorization:`Bearer ${token}`} :{}},body:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json()}));requests.push(p);return p;};
 const paired=await post('/sessions',{token:g.issuePairingToken()}),token=paired.body.sessionToken;
 const compiled=await post('/engineering/compile',{project:bundle.locked.project},token),ref={bundleDigest:compiled.body.bundleDigest,projectDigest:compiled.body.projectDigest};
 const made=await post('/runs',{scenarioId:'IR-FD01',scenarioRevision:1,seed:5,mode:'simulation',access:'simulated',backendSetId:IR,runtimeIdentity:{sourceCommit:'test-commit',schemaHash},engineeringRef:ref},token);expect(made.status).toBe(201);
 const path=`/runs/${made.body.run.id}/actions`,started=await post(path,{actionId:'start',expectedRevision:made.body.run.runRevision,kind:'start',payload:{}},token);expect(started.status).toBe(200);
 const batch=post(path,{actionId:'batch',expectedRevision:started.body.run.runRevision,kind:'step',payload:{ticks:20,pace:{factor:1}}},token).catch(()=>null);await boundary.promise;
 const pause=post(path,{actionId:'pause',expectedRevision:started.body.run.runRevision,kind:'pause',payload:{}},token).catch(()=>null);await admitted.promise;
 let closed=false;const closing=g.close().then(()=>{closed=true;});await turn();expect(closed).toBe(false);expect(workerClosed).toBe(false);
 await expect(startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash})).rejects.toThrow('LAB_DATA_DIR_BUSY');
 release.release();await Promise.all([batch,pause,closing]);expect(workerClosed).toBe(true);expect(run.pulse()).toMatchObject({tick:1,paused:true,runRevision:started.body.run.runRevision+2});
 const replacement=await startLabGateway({port:0,directory,sourceCommit:'test-commit',schemaHash});await replacement.close();
},120_000);

test.skipIf(!irsimAvailable)('a control failing checkpoint persistence after admission still ends the batch at its boundary',async()=>{
 const f=await fixture(),batch=f.batch();await f.boundary.promise;
 // Inject one owned checkpoint IO failure after the real control admission callback.
 const target=f.run as ScenarioRun&{persist():Promise<void>},persist=target.persist.bind(target);let fail=false;
 target.persist=async()=>{if(fail){fail=false;throw Error('CHECKPOINT_IO_FAILURE');}return persist();};
 const pause=f.run.action({actionId:'failed-pause',expectedRevision:f.rev,kind:'pause',payload:{}},async()=>{fail=true;}).then(()=>null,e=>(e as Error).message);
 f.release.release();expect(await pause).toBe('CHECKPOINT_IO_FAILURE');expect((await batch).body.tick).toBe(1);expect(f.run.pulse().paused).toBe(false);
},120_000);

test.skipIf(!irsimAvailable)('an authorized cached control replays without truncating the batch, reapplying the control or creating another control revision',async()=>{
 const f=await fixture(),paused=await f.act('pause',f.rev),resumed=await f.act('resume',paused.body.run.runRevision);let checks=0;
 const batch=f.run.action({actionId:'later-batch',expectedRevision:resumed.body.run.runRevision,kind:'step',payload:{ticks:2}});
 const retry=f.run.action({actionId:'pause',expectedRevision:f.rev,kind:'pause',payload:{}},async()=>{checks++;});
 const [receipt,stepped]=await Promise.all([retry,batch]);expect(receipt.run).toEqual(paused.body.run);expect(checks).toBe(1);
 expect(stepped.tick).toBe(2);expect(stepped.run.runRevision).toBe(resumed.body.run.runRevision+1);expect(f.run.pulse().paused).toBe(false);
},120_000);

test.skipIf(!irsimAvailable)('same-turn handler step and pause reach the first boundary without an admission microtask gap',async()=>{
 const f=await fixture(),batch=f.batch(),pause=f.act('pause',f.rev);f.release.release();const [s,p]=await Promise.all([batch,pause]);
 expect(p.status,JSON.stringify(p.body)).toBe(200);expect(p.body.tick).toBeLessThanOrEqual(1);expect(s.body.tick).toBe(p.body.tick);
},120_000);

test.skipIf(!irsimAvailable)('a refused queued step still settles readiness and drains its valid control',async()=>{
 const f=await fixture();const batch=f.act('step',f.rev-1,f.a,{},'stale-batch',{ticks:20}),pause=f.act('pause',f.rev);
 const [s,p]=await Promise.all([batch,pause]);expect(s.body.error).toBe('REVISION_CONFLICT');expect(p.status).toBe(200);expect(p.body.tick).toBe(0);expect(p.body.run.status).toBe('paused');
},120_000);

test.skipIf(!irsimAvailable)('transfer before a queued step wakes waiting controls without admitting the former writer',async()=>{
 const f=await fixture(),paused=await f.act('pause',f.rev),entered=gate(),release=gate(),action=f.run.action.bind(f.run);
 f.run.action=async(a,before)=>{if((a as {kind:string}).kind==='resume'){entered.release();await release.promise;}return action(a,before);};
 try{
  const resume=f.act('resume',paused.body.run.runRevision);await entered.promise;
  const transfer=f.writer('transfer'),batch=f.act('step',paused.body.run.runRevision+1,f.a,{},'after-transfer',{ticks:2}),pause=f.act('pause',paused.body.run.runRevision+1,f.a,{},'waiting-pause');
  await turn();release.release();const [r,t,s,p]=await Promise.all([resume,transfer,batch,pause]);expect(r.status).toBe(200);expect(t.status).toBe(200);
  expect([s.body.error,p.body.error]).toEqual(['RUN_WRITER_CONFLICT','RUN_WRITER_CONFLICT']);expect(f.run.pulse()).toMatchObject({tick:0,paused:false});
  expect((await f.act('pause',r.body.run.runRevision,f.b,{'x-lab-control-epoch':'1'},'new-owner')).status).toBe(200);
 }finally{release.release();}
},120_000);

test.skipIf(!irsimAvailable)('a later queued step cannot replace the oldest step control reservation',async()=>{
 const f=await fixture(),first=f.batch();await f.boundary.promise;
 const second=f.act('step',f.rev+2,f.a,{},'second-batch',{ticks:2}),pause=f.act('pause',f.rev);await turn();f.release.release();
 const [a,b,p]=await Promise.all([first,second,pause]);expect(p.status).toBe(200);expect(a.body.tick).toBe(1);expect(p.body.tick).toBe(1);expect(b.body.error).toBe('RUN_PAUSED');expect(f.run.pulse().tick).toBe(1);
},120_000);
