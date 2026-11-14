// Real HTTP sessions and gateway authority; instrumented protocol double, NOT physics evidence.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {TelemetryRecorder} from '../../packages/lab-runtime/src/v2/telemetry';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {xarmProject} from '../support/mujoco-arm';
const gateways:LabGateway[]=[],dirs:string[]=[];afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const origin='http://127.0.0.1:4175';
async function fixture(){
 const directory=await mkdtemp(join(tmpdir(),'writer-'));dirs.push(directory);let now=1000,steps=0,closed=0,revision=0;let hold:Promise<void>|undefined,closeHold:Promise<void>|undefined,journalHold:Promise<void>|undefined;const id=randomUUID(),view=()=>({run:{id,runRevision:revision,status:'running'},tick:steps});
 const g=await startLabGateway({port:0,directory,sourceCommit:'test',schemaHash:'a'.repeat(64),nowMs:()=>now,v2:{catalog:{...defaultCatalog,backends:defaultCatalog.backends.map(b=>b.id==='mujoco_arm'?{...b,installed:true,compatible:true,reachable:true,reason:undefined}:b)},enabledBackends:['mock_amr','mock_coffee','mujoco_arm'],portableChecks:async()=>['model','clock','fixture','profile','runner'].map(id=>({id,status:'ready' as const,reasonCodes:[],evidenceRef:'protocol_double'})),simulationFactory:async(_i,p)=>{await mkdir(p.directory,{recursive:true});return {id,snapshot:async()=>view(),report:async()=>({manifest:{runId:id}}),holdForReclaim:async()=>view(),action:async(a:{kind:string},before?:()=>Promise<void>)=>{if(hold)await hold;await before?.();if(a.kind==='step')steps++;revision++;return view();},close:async()=>{closed++;if(closeHold)await closeHold;},pulse:()=>({tick:steps,paused:true,runRevision:revision}),journal:async()=>{if(journalHold)await journalHold;return [];},telemetry:new TelemetryRecorder()} as unknown as ScenarioRun;}}});gateways.push(g);
 const pair=async()=>{const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});return {...await r.json(),cookie:r.headers.get('set-cookie')!.split(';')[0]!};};
 const call=async(p:{sessionToken:string},path:string,body?:unknown,epoch?:number)=>{const r=await fetch(g.url+'/lab/v2'+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',authorization:`Bearer ${p.sessionToken}`,...epoch!==undefined?{'x-lab-control-epoch':String(epoch)}:{}},...body!==undefined?{body:JSON.stringify(body)}:{}});return {status:r.status,...await r.json()};};
 const a=await pair();const create=(sourceCommit='test')=>call(a,'/runs',{project:xarmProject(),scenarioId:'MJ-BV01',scenarioRevision:1,seed:42,mode:'simulation',access:'simulated',backendSetId:'engineering-mujoco-arm-v1',runtimeIdentity:{sourceCommit,schemaHash:'a'.repeat(64)}});
 const made=await create();expect(made.status,JSON.stringify(made)).toBe(201);const path=`/runs/${id}`,step=(p:typeof a,epoch?:number)=>call(p,path+'/actions',{actionId:randomUUID(),expectedRevision:revision,kind:'step',payload:{ticks:1}},epoch),writer=(p:typeof a,recipient:typeof a,operation:string,controlEpoch:number)=>call(p,path+'/writer',{operation,recipientSessionId:recipient.sessionId,controlEpoch});
 return {g,a,pair,call,create,made,path,step,writer,steps:()=>steps,closed:()=>closed,advance:(ms:number)=>{now+=ms;},hold:(p?:Promise<void>)=>{hold=p;},holdClose:(p:Promise<void>)=>{closeHold=p;},holdJournal:(p:Promise<void>)=>{journalHold=p;},directory};
}
test('explicit read authorization allows two real tokens to race: one writer, one engine step, private404 preserved',async()=>{
 const f=await fixture(),b=await f.pair(),c=await f.pair();expect(f.a.sessionId).toMatch(/^[0-9a-f-]{36}$/);expect(f.a.sessionId).not.toBe(f.a.sessionToken);
 expect((await f.step(b)).status).toBe(404);expect((await f.writer(f.a,b,'grant_read',0)).status).toBe(200);
 const streamAbort=new AbortController(),stream=await fetch(f.g.url+'/lab/v2'+f.path+'/events',{headers:{authorization:`Bearer ${b.sessionToken}`},signal:streamAbort.signal});expect(stream.status).toBe(200);
 const results=await Promise.all([f.step(f.a),f.step(b)]);streamAbort.abort();expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>r.error==='RUN_WRITER_CONFLICT')).toHaveLength(1);expect(f.steps()).toBe(1);
 expect((await f.call(b,f.path+'/report')).status).toBe(200);expect((await f.call(c,f.path+'/report')).status).toBe(404);expect((await f.call(b,f.path+'/archive',{})).error).toBe('RUN_WRITER_CONFLICT');expect((await f.writer(b,c,'transfer',0)).error).toBe('RUN_WRITER_CONFLICT');expect((await f.create('wrong-pin')).error).toBe('CONTRACT_MISMATCH');
});
test('transfer fences former and stale writers, requires later epochs, and former creator expiry does not close new writer',async()=>{
 const f=await fixture();f.advance(1000);const b=await f.pair();expect((await f.writer(f.a,b,'transfer',0)).writer).toMatchObject({runId:f.made.run.id,sessionId:b.sessionId,controlEpoch:1});
 expect((await f.step(f.a,0)).error).toBe('RUN_WRITER_CONFLICT');expect((await f.step(b)).error).toBe('RUN_WRITER_CONFLICT');expect((await f.step(b,0)).error).toBe('RUN_WRITER_CONFLICT');expect((await f.step(b,1)).status).toBe(200);
 f.advance(3599001);await f.call(b,'/readiness',{scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1',project:xarmProject()});expect(f.closed()).toBe(0);expect((await f.step(b,1)).status).toBe(200);
 const c=await f.pair();expect((await f.call(c,f.path+'/reclaim',{proof:f.made.reclaimToken})).controlAccess).toBe('view_reconcile');expect((await f.step(c,2)).error).toBe('RECLAIM_READ_ONLY');expect((await f.writer(c,b,'transfer',2)).error).toBe('RUN_WRITER_CONFLICT');expect((await f.step(b,1)).status).toBe(404);
});
test('queued actions and transfer serialize; action admission alone never survives session expiry',async()=>{
 const f=await fixture(),b=await f.pair();let release!:()=>void;f.hold(new Promise<void>(r=>release=r));const first=f.step(f.a);await new Promise(r=>setTimeout(r,30));const transfer=f.writer(f.a,b,'transfer',0);await new Promise(r=>setTimeout(r,30));release();f.hold();expect((await first).status).toBe(200);expect((await transfer).status).toBe(200);expect((await f.step(f.a,0)).error).toBe('RUN_WRITER_CONFLICT');
 f.hold(new Promise<void>(r=>release=r));const pending=f.step(b,1);await new Promise(r=>setTimeout(r,30));f.advance(3600001);release();expect((await pending).status).toBe(401);expect(f.steps()).toBe(1);
});
test('writer route retains cookie CSRF, Origin, CORS header and strict recipient validation',async()=>{
 const f=await fixture(),b=await f.pair(),url=f.g.url+'/lab/v2'+f.path+'/writer',body=JSON.stringify({operation:'transfer',recipientSessionId:b.sessionId,controlEpoch:0});
 expect((await fetch(url,{method:'POST',headers:{origin,'content-type':'application/json',cookie:f.a.cookie},body})).status).toBe(403);
 expect((await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${f.a.sessionToken}`},body})).status).toBe(403);
 const preflight=await fetch(url,{method:'OPTIONS',headers:{origin,'access-control-request-headers':'authorization,x-lab-control-epoch'}});expect(preflight.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-lab-control-epoch');
 expect((await f.call(f.a,f.path+'/writer',{operation:'transfer',recipientSessionId:randomUUID(),controlEpoch:0})).error).toBe('INVALID_WRITER_RECIPIENT');
});

test('public close holds the data root until its active worker acknowledges close',async()=>{
 const f=await fixture();let release!:()=>void;f.holdClose(new Promise<void>(r=>release=r));let settled=false;const closing=f.g.close().then(()=>{settled=true;});
 for(let n=0;n<100&&!f.closed();n++)await new Promise(r=>setTimeout(r,5));expect(f.closed()).toBe(1);expect(settled).toBe(false);
 await expect(startLabGateway({port:0,directory:f.directory,sourceCommit:'test',schemaHash:'a'.repeat(64)})).rejects.toThrow('LAB_DATA_DIR_BUSY');release();await closing;
 const g=await startLabGateway({port:0,directory:f.directory,sourceCommit:'test',schemaHash:'a'.repeat(64)});gateways.push(g);
});

test('public close retains ownership until an admitted SSE journal read settles',async()=>{
 const f=await fixture();let release!:()=>void;f.holdJournal(new Promise<void>(r=>release=r));
 const response=await fetch(f.g.url+'/lab/v2'+f.path+'/events',{headers:{authorization:`Bearer ${f.a.sessionToken}`}});expect(response.status).toBe(200);
 let settled=false;const closing=f.g.close().then(()=>{settled=true;});
 try{await new Promise(r=>setTimeout(r,50));expect(settled).toBe(false);await expect(startLabGateway({port:0,directory:f.directory,sourceCommit:'test',schemaHash:'a'.repeat(64)})).rejects.toThrow('LAB_DATA_DIR_BUSY');}finally{release();await closing;}
});
