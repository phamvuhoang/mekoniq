// SSE read through fetch + ReadableStream (D56): exactly the part of the EventSource interface stream.ts uses, so it can send a bearer header and
// the loopback address space. It never reconnects by itself: when the stream ends or fails it is closed (readyState 2) and reports one error;
// stream.ts then probes and reconnects from its cursor. close() aborts the request and reports nothing.
/** Unparsed bytes plus the pending record's data: beyond this the stream is treated as broken (one error), never buffered without bound. */
export const MAX_PENDING=1<<20;
type Listener=(e:{data:string;lastEventId:string})=>void;
export class FetchEventSource {
 readyState:0|1|2=0;onopen:(()=>void)|null=null;onerror:(()=>void)|null=null;
 private listeners=new Map<string,Listener[]>();private abort=new AbortController();
 constructor(readonly url:string,init:{headers?:Record<string,string>;fetch?:typeof fetch;extra?:RequestInit}={}){void this.read(init);}
 addEventListener(type:string,listener:Listener){this.listeners.set(type,[...this.listeners.get(type)??[],listener]);}
 close(){this.readyState=2;this.abort.abort();}
 private fail(){if(this.abort.signal.aborted)return;this.close();this.onerror?.();}
 private async read(init:{headers?:Record<string,string>;fetch?:typeof fetch;extra?:RequestInit}){
  try{
   const get=init.fetch??fetch.bind(globalThis),extra=init.extra??{};
   const response=await get(this.url,{...extra,headers:{...extra.headers as Record<string,string>,...init.headers,Accept:'text/event-stream'},cache:'no-store',signal:this.abort.signal});
   if(this.abort.signal.aborted)return;
   // a 200 that is not an event stream (a proxy's page, a JSON error) is a failure too
   if(!response.ok||!response.body||!/^text\/event-stream\b/i.test(response.headers.get('content-type')??''))return this.fail();
   this.readyState=1;this.onopen?.();
   const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
   let buffer='',data:string[]=[],event='',id='',pending=0;
   for(;;){
    const {done,value}=await reader.read();if(done||this.abort.signal.aborted)break;
    buffer+=value;
    for(let i;(i=buffer.search(/[\r\n]/))>=0;){
     if(buffer[i]==='\r'&&i===buffer.length-1)break;// a CR at the end of a chunk may be half of a CRLF: wait for the next chunk
     const line=buffer.slice(0,i);buffer=buffer.slice(i+(buffer[i]==='\r'&&buffer[i+1]==='\n'?2:1));
     if(!line){// a blank line ends the record; an unfinished one at the end of the stream is never dispatched
      if(data.length)for(const f of this.listeners.get(event||'message')??[])try{f({data:data.join('\n'),lastEventId:id});}catch(e){queueMicrotask(()=>{throw e;});}// a listener's error never ends the stream
      data=[];event='';pending=0;continue;
     }
     if(line.startsWith(':'))continue;// comment
     const c=line.indexOf(':'),field=c<0?line:line.slice(0,c),v=c<0?'':line.slice(c+1).replace(/^ /,'');
     if(field==='data'){data.push(v);pending+=v.length;}else if(field==='event')event=v;else if(field==='id'&&!v.includes('\0'))id=v;// retry: ignored (no reconnect here)
    }
    // bounded after the complete records of this chunk were consumed: only what is still unparsed, plus the unfinished record's data, counts
    if(buffer.length+pending>MAX_PENDING)return this.fail();
   }
  }catch{/* aborted or a network error */}
  this.fail();
 }
}
