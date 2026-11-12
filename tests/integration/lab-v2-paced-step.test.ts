// N02 (D57, SX-45): `step{ticks,pace:{factor}}` holds a mock-default run at wall-clock rate through the gateway (real wall clock, real waiting: ~45 s).
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLabGateway,type LabGateway} from '../../packages/lab-runtime/src/gateway';
import {STREAM_DEFAULTS} from '../../packages/lab-runtime/src/v2/event-stream';
import {realWall,type WallClock} from '../../packages/lab-runtime/src/v2/pace';
import {coffeeProject,COFFEE_BACKENDS} from '../support/lab-v2';
const origin='http://127.0.0.1:4175',hash='a'.repeat(64);
const gateways:LabGateway[]=[],dirs:string[]=[];
afterEach(async()=>{for(const g of gateways.splice(0))await g.close();for(const d of dirs.splice(0))await rm(d,{force:true,recursive:true});});
type Headers=Record<string,string>;
interface View {run:{id:string;runRevision:number;status:string};tick:number}
/** The real wall clock, counted. */
const calls={now:0,sleep:0},wall:WallClock={now:()=>{calls.now++;return realWall.now();},sleep:ms=>{calls.sleep++;return realWall.sleep(ms);}};
async function open(){
 const dir=await mkdtemp(join(tmpdir(),'lab-v2-pace-'));dirs.push(dir);
 const g=await startLabGateway({port:0,directory:dir,sourceCommit:'test-commit',schemaHash:hash,v2:{enabledBackends:COFFEE_BACKENDS,wall}});gateways.push(g);
 const r=await fetch(g.url+'/lab/v2/sessions',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:g.issuePairingToken()})});expect(r.status).toBe(201);
 const h:Headers={Origin:origin,'Content-Type':'application/json',Cookie:r.headers.get('set-cookie')!.split(';')[0]!,'X-CSRF-Token':(await r.json() as {csrfToken:string}).csrfToken};
 const created=await (await fetch(g.url+'/lab/v2/runs',{method:'POST',headers:h,body:JSON.stringify({project:coffeeProject(),scenarioId:'BV01',scenarioRevision:1,seed:42,mode:'mock',backendSetId:'mock-default',access:'simulated',runtimeIdentity:{sourceCommit:'test-commit',schemaHash:hash}})})).json() as View;
 const url=`${g.url}/lab/v2/runs/${created.run.id}`;let rev=created.run.runRevision,n=0;
 const send=(kind:string,payload:Record<string,unknown>={},o:{actionId?:string;expectedRevision?:number;signal?:AbortSignal}={})=>fetch(url+'/actions',{method:'POST',headers:h,signal:o.signal,body:JSON.stringify({actionId:o.actionId??`a${++n}`,expectedRevision:o.expectedRevision??rev,kind,payload})});
 const act=async(kind:string,payload:Record<string,unknown>={})=>{const r=await send(kind,payload);expect(r.status).toBe(200);const v=await r.json() as View;rev=v.run.runRevision;return v;};
 const get=async()=>{const v=await (await fetch(url,{headers:h})).json() as View;rev=v.run.runRevision;return v;};
 await act('start');
 return {g,h,send,act,get,rev:()=>rev};
}
const within=(ms:number,target:number)=>expect(Math.abs(ms-target)/target).toBeLessThanOrEqual(0.03);
const report=(name:string,ms:number)=>console.log(`N02 measured wall ms ${name}=${Math.round(ms)}`);

test('75 paced steps of 20 ticks (30 s simulated) take 30 s at 1x and 7.5 s at 4x, within 3 %',async()=>{
 const r=await open();
 for(const [factor,target] of [[1,30000],[4,7500]] as const){
  const t0=performance.now();for(let i=0;i<75;i++)await r.act('step',{ticks:20,pace:{factor}});
  const ms=performance.now()-t0;report(`factor${factor}`,ms);within(ms,target);
 }
 expect((await r.get()).tick).toBe(3000);expect(calls.sleep).toBeGreaterThan(0); // the gateway's injected wall paced it
},90000);

test('ticks above 50 with pace and a factor outside 1, 4, 16, 64 are INVALID_ACTION; a step without pace never touches the wall clock',async()=>{
 const r=await open(),before=await r.get();
 for(const payload of [{ticks:51,pace:{factor:1}},{ticks:20,pace:{factor:2}}]){const x=await r.send('step',payload);expect(x.status).toBe(422);expect((await x.json() as {error:string}).error).toBe('INVALID_ACTION');}
 expect((await r.get()).tick).toBe(before.tick);
 const c={...calls},v=await r.act('step',{ticks:3000});
 expect(v.tick).toBe(before.tick+3000);expect(calls).toEqual(c);
},60000);

test('a paced step whose client goes away completes exactly its ticks, then the run stands still; the same actionId returns the stored receipt',async()=>{
 const r=await open(),before=await r.get(),ctl=new AbortController(),rev=r.rev();
 const lost=r.send('step',{ticks:50,pace:{factor:1}},{actionId:'lost-step',expectedRevision:rev,signal:ctl.signal}).catch(e=>e as Error);
 await realWall.sleep(200);ctl.abort();expect(await lost).toBeInstanceOf(Error);
 await realWall.sleep(1800);const after=await r.get();expect(after.tick).toBe(before.tick+50);
 await realWall.sleep(1000);expect((await r.get()).tick).toBe(before.tick+50);
 const sleeps=calls.sleep,again=await r.send('step',{ticks:50,pace:{factor:1}},{actionId:'lost-step',expectedRevision:rev});
 expect(again.status).toBe(200);const receipt=await again.json() as View;
 expect(receipt.tick).toBe(before.tick+50);expect(receipt.run.runRevision).toBe(after.run.runRevision);expect(calls.sleep).toBe(sleeps);
 expect((await r.get()).tick).toBe(before.tick+50);
},30000);

test('a pause sent while a paced step runs is answered within 500 ms',async()=>{
 const r=await open(),rev=r.rev();
 const step=r.send('step',{ticks:20,pace:{factor:1}},{expectedRevision:rev});
 await realWall.sleep(100);
 // actions on one run are serialised: the pause is taken right after the step, at the revision the step produces
 const t0=performance.now(),pause=await r.send('pause',{},{expectedRevision:rev+1}),ms=performance.now()-t0;report('pause',ms);
 expect((await step).status).toBe(200);expect(pause.status).toBe(200);expect((await pause.json() as View).run.status).toBe('paused');
 expect(ms).toBeLessThanOrEqual(500);
},30000);

test('telemetry is pushed every 40 ms and health advertises the paced step',async()=>{
 expect(STREAM_DEFAULTS.telemetryMs).toBe(40);
 const r=await open(),health=await (await fetch(r.g.url+'/lab/v2/health',{headers:{Origin:origin}})).json() as {features:Record<string,boolean>};
 expect(health.features.pacedStep).toBe(true);
});
