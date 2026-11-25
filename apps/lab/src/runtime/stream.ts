// Run streams from the source v2 gateway: durable business events (journal cursor, resumable) and coalesced telemetry on separate SSE
// connections, with a snapshot poll fallback (500 ms foreground / 2 s background). Read-only: nothing here can send an action.
export type LinkState='connecting'|'live'|'polling'|'reconnecting'|'session_lost'|'run_lost'|'runtime_lost'|'closed';
export interface BusinessEntry {sequence:string;at:string;events:{type:string;kind:string;id:string;state:Record<string,unknown>}[]}
export interface Heartbeat {monotonicNs:string;tick:number;paused:boolean;runRevision:number}
export interface StreamHandlers<V=unknown,S=unknown> {
 onBusiness?(e:BusinessEntry):void;
 /** The cursor could not be resumed: resynchronise from this snapshot (explicit, never a silent skip). */
 onReset?(snapshot:V,reason:string):void;
 onSample?(s:S):void;onGap?(g:Record<string,unknown>):void;onHeartbeat?(h:Heartbeat):void;
 /** Poll fallback only: the latest snapshot. */
 onSnapshot?(v:V):void;onState?(s:LinkState):void;
}
export interface StreamDeps {base?:string;EventSource?:typeof EventSource;fetch?:typeof fetch;visible?:()=>boolean;
 /** Fires 'offline'/'online' (the window). A dead network can leave a TCP stream looking open; these and the heartbeat deadline catch it. */
 network?:EventTarget|null;heartbeatDeadlineMs?:number}
export function openRunStreams<V=unknown,S=unknown>(runId:string,cursor:string|null,h:StreamHandlers<V,S>,d:StreamDeps={}){
 const base=d.base??'/lab/v2',ES=d.EventSource,get=d.fetch??fetch.bind(globalThis),visible=d.visible??(()=>typeof document==='undefined'||document.visibilityState!=='hidden');
 const runUrl=`${base}/runs/${encodeURIComponent(runId)}`;
 const network=d.network===undefined?(typeof window==='undefined'?null:window):d.network,deadline=d.heartbeatDeadlineMs??5000;
 let state:LinkState='connecting',lastEventId=cursor,closed=false,timer:ReturnType<typeof setTimeout>|undefined,watchdog:ReturnType<typeof setInterval>|undefined,sources:EventSource[]=[],beat=Date.now(),probing=false,refusals=0;
 const set=(s:LinkState)=>{if(state!==s||s==='closed'){state=s;h.onState?.(s);}};
 const json=(e:MessageEvent)=>JSON.parse(String(e.data)) as Record<string,unknown>;
 const stop=()=>{for(const s of sources)s.close();sources=[];};
 /** Why did the runtime refuse/close the stream? 401: pairing session gone (restart) -> re-pair; 404: run unknown; else runtime unreachable. */
 const probe=async()=>{
  if(closed||probing)return;probing=true;
  let status=0,response:Response|undefined;try{response=await get(runUrl,{credentials:'same-origin',cache:'no-store'});status=response.status;}catch{status=0;}
  probing=false;if(closed)return;
  if(status===401){stop();return set('session_lost');}
  if(status===404){stop();return set('run_lost');}
  if(status===200){
   stop();refusals++;set('polling');try{h.onSnapshot?.(await response!.json() as V);}catch{/* a later poll retries the snapshot */}
   if(closed)return;clearTimeout(timer);
   timer=setTimeout(()=>{if(refusals>=3)void poll();else connect();},Math.min(500*2**(refusals-1),2000));return;
  }
  stop();set('runtime_lost');timer=setTimeout(()=>void probe(),2000);
 };
 const on=(s:EventSource,type:string,f:(e:MessageEvent)=>void)=>s.addEventListener(type,f as EventListener);
 function connect(){
  if(closed)return;
  const events=new ES!(`${runUrl}/events${lastEventId?`?after=${encodeURIComponent(lastEventId)}`:''}`,{withCredentials:true});
  const telemetry=new ES!(`${runUrl}/telemetry`,{withCredentials:true});
  sources=[events,telemetry];
  events.onopen=()=>set('live');
  on(events,'business',e=>{lastEventId=e.lastEventId||lastEventId;set('live');h.onBusiness?.(json(e) as unknown as BusinessEntry);});
  on(events,'reset',e=>{const r=json(e);lastEventId=e.lastEventId||null;set('live');h.onReset?.(r.snapshot as V,String(r.reason));});
  for(const s of sources)on(s,'heartbeat',e=>{beat=Date.now();refusals=0;h.onHeartbeat?.(json(e) as unknown as Heartbeat);});
  on(telemetry,'sample',e=>h.onSample?.(json(e) as S));
  on(telemetry,'gap',e=>h.onGap?.(json(e)));
  for(const s of sources)s.onerror=()=>{if(closed||!sources.includes(s))return;if(s.readyState===2)void probe();else set('reconnecting');};
 }
 const poll=async()=>{
  if(closed)return;
  try{const r=await get(runUrl,{credentials:'same-origin',cache:'no-store'});
   if(r.status===401)return set('session_lost');if(r.status===404)return set('run_lost');
   if(r.ok){set('polling');h.onSnapshot?.(await r.json() as V);}else set('runtime_lost');
  }catch{set('runtime_lost');}
  if(!closed)timer=setTimeout(()=>void poll(),visible()?500:2000);
 };
 /** Drop the connections and start again from the last durable cursor (the server resumes after it or sends a reset). */
 const restart=()=>{if(closed||!ES)return;clearTimeout(timer);stop();set('reconnecting');beat=Date.now();refusals=0;connect();};
 const offline=()=>{if(closed||!ES)return;clearTimeout(timer);stop();set('reconnecting');},online=()=>restart();
 network?.addEventListener('offline',offline);network?.addEventListener('online',online);
 if(ES){connect();watchdog=setInterval(()=>{if(sources.length&&Date.now()-beat>deadline)restart();},1000);}
 else timer=setTimeout(()=>void poll(),visible()?500:2000);
 return {
  get state(){return state;},get lastEventId(){return lastEventId;},
  close(){closed=true;clearTimeout(timer);clearInterval(watchdog);network?.removeEventListener('offline',offline);network?.removeEventListener('online',online);stop();set('closed');},
 };
}
