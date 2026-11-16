// Owned local gateway, deterministic clock/barriers; protocol double, no worker or motion.
import {afterEach,expect,test,vi} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createV2Gateway} from '../../packages/lab-runtime/src/v2/gateway';
import * as store from '../../packages/lab-runtime/src/v2/reclaim-store';
import type {ScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
const gate=()=>{let release!:()=>void;return {promise:new Promise<void>(r=>release=r),release:()=>release()};};
afterEach(()=>vi.restoreAllMocks());
for(const existing of [false,true])for(const boundary of ['factory','grant','closure','hold','persist'] as const)for(const invalidation of ['expiry','revocation']){
 if(existing&&boundary==='factory')continue;
 test(`reclaim ${existing?'existing':'cold'} refuses ${invalidation} across ${boundary}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'reclaim-auth-')),runDirectory=join(directory,'run'),id=randomUUID();await mkdir(runDirectory);
  await store.saveReclaim(runDirectory,{runId:id,proofHash:store.proofHash('proof'),schemaHash:'schema',input:{mode:'simulation',sourceCommit:'test',engineering:{ref:{bundleDigest:'bundle'},runtimeProjection:{assets:[]}}} as never});
  let now=0,armed=false,closes=0,opens=0,holds=0,grants=0;const entered=gate(),release=gate(),wait=async(at:string)=>{if(armed&&boundary===at){entered.release();await release.promise;}};
  const original=store.saveControlEpoch;vi.spyOn(store,'saveControlEpoch').mockImplementation(async(...args)=>{await original(...args);await wait('persist');});
  const requests=new WeakMap<IncomingMessage,Record<string,unknown>>(),responses=new WeakMap<ServerResponse,{status:number;body:{sessionToken?:string;writer?:{controlEpoch:number}}}>();
  const g=createV2Gateway({directory,sourceCommit:'test',schemaHash:'schema',now:()=>now,pairingValid:()=>true,accessKeyValid:()=>true,spendPairing(){},same:(a,b)=>a===b,readBody:async r=>requests.get(r)!,send:(r,status,body)=>{responses.set(r,{status,body:body as never});},engineering:{grantRun:async()=>{grants++;await wait('grant');},verifyClosure:async()=>{await wait('closure');return [];}} as never,simulationFactory:async(_input,providers)=>{expect(providers.reclaimOnly).toBe(true);opens++;await wait('factory');return {id,holdForReclaim:async()=>{holds++;await wait('hold');return {run:{id,runRevision:0},tick:0};},snapshot:async()=>({run:{id,runRevision:0},tick:0}),close:async()=>{closes++;}} as unknown as ScenarioRun;}});
  const call=async(path:string,body:Record<string,unknown>,token?:string)=>{const req={method:'POST',headers:token?{authorization:`Bearer ${token}`}:{}} as IncomingMessage,res={setHeader(){}} as unknown as ServerResponse;requests.set(req,body);await g(req,res,'/lab/v2'+path,'http://127.0.0.1:4175');return responses.get(res)!;};
  const pair=async()=>String((await call('/sessions',{token:'key'})).body.sessionToken),path=`/runs/${id}`;let pending:Promise<unknown>|undefined;
  try{
   const requester=await pair();now=1;const owner=await pair();if(existing)expect((await call(path+'/reclaim',{proof:'proof'},owner)).status).toBe(200);
   armed=true;pending=call(path+'/reclaim',{proof:'proof'},requester);await entered.promise;
   if(invalidation==='expiry')now=3600000;else for(let n=0;n<9;n++)await pair();
   release.release();const refused=await pending as Awaited<ReturnType<typeof call>>;expect(refused).toMatchObject({status:401,body:{error:'SESSION_REQUIRED'}});
   expect(opens).toBe(1);expect(closes).toBe(existing?0:1);
   const epoch=(await store.findReclaim(directory,id))!.record.controlEpoch??0;expect(epoch).toBe((existing?1:0)+(boundary==='persist'?1:0));
   if(boundary==='factory')expect(grants).toBe(0);if(['factory','grant','closure'].includes(boundary))expect(holds).toBe(existing?1:0);
   armed=false;const recovered=await call(path+'/reclaim',{proof:'proof'},owner);expect(recovered.status).toBe(200);expect(recovered.body.writer!.controlEpoch).toBe(epoch+1);expect(opens).toBe(existing?1:2);
  }finally{release.release();await pending;await g.close();await rm(directory,{recursive:true,force:true});}
 });
}
