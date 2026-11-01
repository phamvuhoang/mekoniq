import type { RobotCommand } from '../../../contracts/src/index';
import { lanEndpoint, routes, type ValetudoProfile } from './capabilities';
import { sampleOf, type ValetudoSample } from './map';
import type { ValetudoTransport } from './adapter';
/** Body read with a byte cap after any Content-Encoding is undone: a gzip map that inflates past maxBytes is abandoned, never buffered. */
async function readCapped(response:Response,maxBytes:number):Promise<string> {
 const reader=response.body?.getReader(); if(!reader) return '';
 const chunks:Uint8Array[]=[];let size=0;
 for(;;) {
  const {done,value}=await reader.read(); if(done) break;
  size+=value.byteLength; if(size>maxBytes) {await reader.cancel();throw new Error('MAP_TOO_LARGE');}
  chunks.push(value);
 }
 const out=new Uint8Array(size);let at=0;for(const c of chunks){out.set(c,at);at+=c.byteLength;}
 return new TextDecoder().decode(out);
}
/**
 * Valetudo REST v2 over the LAN (no broker needed). Reference transport for protocol conformance and dev rigs; on the tablet only the native
 * executor talks to a robot, and dispatchRobotEffects refuses a non-native adapter for any non-simulated robot.
 */
export class RestTransport implements ValetudoTransport {
 readonly kind='rest' as const;
 private origin:string;
 constructor(private profile:Pick<ValetudoProfile,'endpoint'|'requestTimeoutMs'|'maxMapBytes'>,private now:()=>number=Date.now,options:{allowLoopback?:boolean}={}) {
  this.origin=lanEndpoint(String(profile.endpoint),options);
 }
 private async request(method:'GET'|'PUT',path:string,body?:unknown,maxBytes=65536):Promise<{status:number;text:string}> {
  const response=await fetch(this.origin+path,{method,redirect:'error',signal:AbortSignal.timeout(this.profile.requestTimeoutMs),headers:{accept:'application/json','accept-encoding':'gzip',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,text:await readCapped(response,maxBytes)};
 }
 async capabilities():Promise<string[]> {
  const r=await this.request('GET',routes.capabilities);
  const list=r.status===200?JSON.parse(r.text):undefined;
  if(!Array.isArray(list)||!list.every(x=>typeof x==='string')) throw new Error('CAPABILITIES_UNAVAILABLE');
  return list;
 }
 /** 200 = Valetudo handed the goal to the firmware; it says nothing about arrival. 400 = refused; anything else, or no answer = unknown. */
 async goto(_command:RobotCommand,goal:{x:number;y:number}) {
  try {
   const r=await this.request('PUT',routes.goto,{action:'goto',coordinates:{x:goal.x,y:goal.y}});
   return r.status===200?{ack:'accepted' as const}:r.status===400?{ack:'rejected' as const,reason:'GOTO_REJECTED'}:{ack:'unknown' as const,reason:`HTTP_${r.status}`};
  } catch {return {ack:'unknown' as const,reason:'NO_ACK'};}
 }
 async stop() {
  try {const r=await this.request('PUT',routes.basicControl,{action:'stop'});return r.status===200?'acknowledged' as const:r.status===400?'rejected' as const:'unknown' as const;}
  catch {return 'unknown' as const;}
 }
 async samples():Promise<ValetudoSample[]> {
  try {
   const [a,m,h]=await Promise.all([this.request('GET',routes.attributes),this.request('GET',routes.map,undefined,this.profile.maxMapBytes),this.request('GET',routes.hostInfo)]);
   if(a.status!==200||m.status!==200||h.status!==200) return [{receivedAtMs:this.now(),reachable:false}];
   return [sampleOf(JSON.parse(a.text),JSON.parse(m.text),this.now(),JSON.parse(h.text))];
  } catch(e) {return [{receivedAtMs:this.now(),reachable:false,error:(e as Error).message}];}
 }
}
