import type {Page,Request,Response} from '@playwright/test';
import {performance} from 'node:perf_hooks';
type Row=Record<string,unknown>;
type Outcome='completed'|'failed'|'timed_out'|'target_closed'|'invalid';
interface Pending {request:Request;response?:Response;timer:ReturnType<typeof setTimeout>;done:Promise<void>;resolve:()=>void;reading:boolean}
/** Observe terminal request events, not Response.finished(): Playwright can leave that promise pending after requestfailed.
 * The request deadline includes required body reads. finish() freezes admission, then drains only that finite set. */
export function observeProductionHTTP(page:Page,data:{responses:Row[];actions:Row[];exports:Row[];errors:string[]},options:{timeoutMs?:number;drainTimeoutMs?:number}={}){
 const timeoutMs=options.timeoutMs??90000,drainTimeoutMs=options.drainTimeoutMs??10000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(drainTimeoutMs)||drainTimeoutMs<=0)throw Error('HTTP_OBSERVER_INVALID_DEADLINE');
 const pending=new Map<Request,Pending>();let stopped=false,drain:Promise<void>|undefined;
 const selected=(r:Request)=>{const p=new URL(r.url()).pathname;return p.startsWith('/lab/v2/')&&!/\/(events|telemetry)$/.test(p);};
 const settle=(entry:Pending,outcome:Outcome,failure?:string,details:Row={})=>{
  if(!pending.delete(entry.request))return;clearTimeout(entry.timer);
  const request=entry.request,path=new URL(request.url()).pathname,timing=request.timing();
  // Only cancellation of disposable display polling is diagnostic. Other failures, all mutations, and replay assets fail capture.
  const optional=outcome==='failed'&&failure==='net::ERR_ABORTED'&&request.method()==='GET'&&/^\/lab\/v2\/runs\/[^/]+\/world-display(?:\/scene)?$/.test(path);
  const classification=optional?'optional-read-cancellation':outcome==='completed'?'observed':'required-observation-failure';
  data.responses.push({path,method:request.method(),status:entry.response?.status()??null,startTime:timing.startTime,responseEnd:timing.responseEnd,timing,outcome,classification,...failure?{failure}:{},...details});
  if(outcome!=='completed'&&!optional)data.errors.push(`HTTP_OBSERVATION_${outcome.toUpperCase()}:${request.method()} ${path}:${failure}`);
  entry.resolve();
 };
 const onRequest=(request:Request)=>{
  if(stopped||!selected(request))return;
  let resolve!:()=>void;const done=new Promise<void>(r=>{resolve=r;});
  const entry:Pending={request,done,resolve,reading:false,timer:setTimeout(()=>settle(entry,'timed_out','REQUEST_OR_BODY_DEADLINE'),timeoutMs)};pending.set(request,entry);
 };
 const onResponse=(response:Response)=>{const entry=pending.get(response.request());if(entry)entry.response=response;};
 const onFailed=(request:Request)=>{const entry=pending.get(request);if(entry)settle(entry,'failed',request.failure()?.errorText??'REQUEST_FAILED');};
 const onFinished=(request:Request)=>{
  const entry=pending.get(request);if(!entry||entry.reading)return;entry.reading=true;
  void (async()=>{
   const response=entry.response;if(!response)throw Error('RESPONSE_MISSING');
   const path=new URL(request.url()).pathname,timing=request.timing(),status=response.status(),runId=path.split('/').at(-2);
   if(status<200||status>=300)throw Error(`HTTP_STATUS_${status}`);
   if(!Number.isFinite(timing.startTime)||timing.startTime<0||!Number.isFinite(timing.responseEnd)||timing.responseEnd<0)throw Error('TERMINAL_TIMING_MISSING');
   if(request.method()==='POST'&&path.endsWith('/actions')){
    const body=request.postDataJSON(),receipt=await response.json();
    if(status!==200||typeof body?.actionId!=='string'||!body.actionId||typeof body.kind!=='string'||receipt?.run?.id!==runId||!Number.isSafeInteger(receipt.tick)||receipt.tick<0||!Number.isSafeInteger(receipt.run.runRevision)||typeof receipt.run.status!=='string')throw Error('ACTION_RECEIPT_INVALID');
    if(!pending.has(request))return;
    const correlation={runId,actionId:body.actionId,tick:receipt.tick,requestStartEpochMs:timing.startTime,responseEndEpochMs:timing.startTime+timing.responseEnd};
    data.actions.push({...correlation,kind:body.kind,payload:body.payload,responseMs:timing.responseEnd,receivedAt:performance.now(),observedAtEpochMs:performance.timeOrigin+performance.now(),revision:receipt.run.runRevision,status:receipt.run.status});settle(entry,'completed',undefined,correlation);
   }else if(request.method()==='POST'&&path.endsWith('/replay')){
    const publication=await response.json(),manifest=publication?.manifest;
    if(status!==201||typeof publication?.exportId!=='string'||!publication.exportId||manifest?.runId!==runId||manifest.documentType!=='web-replay-package'||!Number.isSafeInteger(manifest.horizon?.tick)||manifest.horizon.tick<0)throw Error('REPLAY_PUBLICATION_INVALID');
    if(!pending.has(request))return;
    data.exports.push({runId,status,startEpochMs:timing.startTime,responseMs:timing.responseEnd,receivedAt:performance.now(),exportId:publication.exportId,manifest});settle(entry,'completed',undefined,{runId,exportId:publication.exportId,tick:manifest.horizon.tick});
   }else if(request.method()==='DELETE'&&/^\/lab\/v2\/runs\/[^/]+\/replay\/[^/]+$/.test(path)){
    const ack=await response.json(),releaseRunId=path.split('/').at(-3),exportId=path.split('/').at(-1);
    if(status!==200||ack?.deleted!==true)throw Error('REPLAY_RELEASE_INVALID');
    // The recorder joins release/publication identity after drain; JSON observers may finish out of order.
    settle(entry,'completed',undefined,{runId:releaseRunId,exportId});
   }else settle(entry,'completed');
  })().catch(error=>settle(entry,'invalid',String(error)));
 };
 const detach=()=>{page.off('request',onRequest);page.off('response',onResponse);page.off('requestfinished',onFinished);page.off('requestfailed',onFailed);page.off('close',onClose);page.off('crash',onClose);};
 const dispose=()=>{stopped=true;for(const entry of pending.values())settle(entry,'target_closed','OBSERVER_DISPOSED_OR_TARGET_CLOSED');detach();};
 const onClose=()=>dispose();
 page.on('request',onRequest);page.on('response',onResponse);page.on('requestfinished',onFinished);page.on('requestfailed',onFailed);page.on('close',onClose);page.on('crash',onClose);
 return {finish(){
  if(drain)return drain;stopped=true;page.off('request',onRequest);
  drain=(async()=>{const timer=setTimeout(()=>{for(const entry of pending.values())settle(entry,'timed_out','DRAIN_DEADLINE');},drainTimeoutMs);try{await Promise.all([...pending.values()].map(e=>e.done));}finally{clearTimeout(timer);detach();}})();return drain;
 },dispose};
}
