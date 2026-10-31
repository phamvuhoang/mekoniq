export type RealtimeHint={scope:{organizationId:string;venueId:string};ref:string;revision:number;watermark:string};
export function venueChannel(scope:RealtimeHint['scope']){return `venue:${scope.organizationId}:${scope.venueId}`;}
/** Hints only wake durable pull. Lost/duplicate hints never change a persisted cursor. */
export function catchUpOnHints(subscribe:(notify:()=>void)=>()=>void,pull:()=>Promise<void>,intervalMs=15000){
 let running=false;let again=false;let stopped=false;
 async function run(){if(stopped)return;if(running){again=true;return;}running=true;try{do{again=false;await pull();}while(again&&!stopped);}finally{running=false;}}
 const wake=()=>{void run().catch(()=>{/* next bounded poll retries without changing cursor */});};
 const unsubscribe=subscribe(wake);const timer=setInterval(wake,intervalMs);wake();
 return()=>{stopped=true;clearInterval(timer);unsubscribe();};
}
