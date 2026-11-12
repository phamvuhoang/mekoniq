// SSE for one run: durable business events keyed by the journal sequence (resumable with Last-Event-ID, never dropped) and, on a separate
// connection, coalesced telemetry (lossy, explicit gaps). A cursor that cannot be resumed gets a `reset` record carrying a fresh snapshot.
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {JsonObject} from '../../../contracts/src/index';
import {TelemetryPublisher} from './telemetry';
import type {ScenarioRun} from './scenario-runner';
export interface SseSink {write(chunk:string):boolean}
export interface JournalEvents {sequence:string;at:string;events:{type:string;kind:string;id:string;state:JsonObject}[]}
export interface StreamOptions {pollMs:number;telemetryMs:number;heartbeatMs:number;eventWindow:number}
export const STREAM_DEFAULTS:StreamOptions={pollMs:250,telemetryMs:40,heartbeatMs:1000,eventWindow:5000};
/** One SSE record. Records without an id (heartbeat, gap) leave the browser's Last-Event-ID unchanged. */
export const sseFrame=(event:string,data:unknown,id?:string|null)=>`${id!=null?`id: ${id}\n`:''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const SEQ=/^\d{1,20}$/;
/**
 * Where to resume in `entries` (journal order) for a client cursor. Only the newest `window` entries are resumable; an older cursor,
 * one beyond the journal and a malformed one are explicit resets, never a silent skip.
 */
export function resumePoint(entries:readonly {sequence:string}[],cursor:string|undefined,window:number):{from:number}|{reset:'CURSOR_TOO_OLD'|'CURSOR_UNKNOWN'|'CURSOR_INVALID'}{
 const start=Math.max(0,entries.length-window);
 if(cursor===undefined||cursor==='')return start===0?{from:0}:{reset:'CURSOR_TOO_OLD'};
 if(!SEQ.test(cursor))return {reset:'CURSOR_INVALID'};
 const c=BigInt(cursor),first=start<entries.length?BigInt(entries[start]!.sequence):null,last=entries.length?BigInt(entries[entries.length-1]!.sequence):0n;
 if(c>last)return {reset:'CURSOR_UNKNOWN'};
 if(first===null||c===first-1n)return {from:start};
 if(c<first-1n)return start===0?{from:0}:{reset:'CURSOR_TOO_OLD'};
 const i=entries.findIndex((e,k)=>k>=start&&BigInt(e.sequence)===c);
 return i<0?{reset:'CURSOR_UNKNOWN'}:{from:i+1};
}
/** Writes entries after `cursor` until the socket signals backpressure; returns the last cursor written. Business events are never dropped. */
export function pumpEvents(sink:SseSink,entries:readonly JournalEvents[],cursor:string|null,blocked=false):string|null{
 if(blocked)return cursor;
 const c=cursor===null?-1n:BigInt(cursor);
 for(const e of entries){if(BigInt(e.sequence)<=c)continue;cursor=e.sequence;if(!sink.write(sseFrame('business',e,e.sequence)))break;}
 return cursor;
}
/** Serves one stream connection until the client goes away or the gateway closes it. */
export function serveRunStream(kind:'events'|'telemetry',run:ScenarioRun,request:IncomingMessage,response:ServerResponse,o:StreamOptions,url:URL,onEnd:()=>void,authorized:()=>boolean){
 response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Content-Type-Options':'nosniff'});
 response.write(`retry: 2000\n\n`);
 let blocked=false,closed=false,busy=false;const timers:NodeJS.Timeout[]=[];
 const sink:SseSink={write:c=>{if(!active())return false;const ok=response.write(c);if(!ok)blocked=true;return ok;}};
 const publisher=kind==='telemetry'?new TelemetryPublisher(sink):null;
 const drain=()=>{blocked=false;publisher?.drained();};response.on('drain',drain);
 const end=()=>{if(closed)return;closed=true;for(const t of timers)clearInterval(t);request.off('close',end);response.off('close',end);response.off('finish',end);response.off('drain',drain);onEnd();};
 const active=()=>{if(closed)return false;if(authorized())return true;end();response.end();return false;};
 request.on('close',end);response.on('close',end);response.on('finish',end);
 const beat=()=>{if(active()&&!blocked){const p=run.pulse();sink.write(sseFrame('heartbeat',{monotonicNs:String(process.hrtime.bigint()),...p}));}};
 timers.push(setInterval(beat,o.heartbeatMs));
 const lastId=typeof request.headers['last-event-id']==='string'?request.headers['last-event-id']:undefined;
 if(publisher){
  const t=run.telemetry,from=lastId!==undefined&&SEQ.test(lastId)?lastId:null,now=t.cursor()??'0';
  // telemetry cannot be replayed: a reconnect is told how much it missed, then gets the latest per entity
  if(from!==null)sink.write(sseFrame('gap',{reason:'RECONNECT',fromSeq:from,toSeq:now,samplesNotSent:t.countBetween(from,now)}));
  for(const g of t.gaps)sink.write(sseFrame('gap',g));
  const push=()=>{if(active())publisher.offer(t.latest());};push();timers.push(setInterval(push,o.telemetryMs));
  return;
 }
 const cursor0=lastId??url.searchParams.get('after')??undefined;
 let cursor:string|null=null,seen='';
 const pump=async(first:boolean)=>{
  if(!active()||busy)return;
  const p=run.pulse(),key=`${p.runRevision}:${p.tick}`;if(!first&&(key===seen||blocked))return;
  busy=true;
  try{
   const entries=await run.journal();if(closed)return;seen=key;
   if(first){
    const r=resumePoint(entries,cursor0,o.eventWindow);
    if('reset' in r){const snapshot=await run.snapshot();if(closed)return;cursor=snapshot.run.eventCursor;sink.write(sseFrame('reset',{reason:r.reset,cursor:cursor0??null,snapshot},cursor??''));}
    else cursor=r.from>0?entries[r.from-1]!.sequence:null;
   }
   cursor=pumpEvents(sink,entries,cursor,blocked);
   if(cursor!==(entries[entries.length-1]?.sequence??null))seen=''; // more to send once drained
  }catch{response.end();}finally{busy=false;}
 };
 void pump(true);timers.push(setInterval(()=>void pump(false),o.pollMs));
}
