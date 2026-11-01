import { inflateSync } from 'node:zlib';
import type { RobotCommand } from '../../../contracts/src/index';
import type { ValetudoProfile } from './capabilities';
import { parseMap, type ValetudoSample } from './map';
import type { ValetudoTransport } from './adapter';
/**
 * Minimal broker connection the transport needs. No MQTT client library is installed in this repo, so production wiring of a real client
 * (with per-robot credentials and an ACL limited to this robot's topics) is left to the deployment; tests use an in-process fake broker.
 */
export interface MqttConnection {
 readonly connected:boolean;
 publish(topic:string,payload:string,options:{qos:0|1;retain:false}):Promise<void>;
 subscribe(filter:string,handler:(topic:string,payload:Uint8Array,retained:boolean)=>void):void;
}
/** Valetudo map-data is zlib-deflated JSON (MapNodeMqttHandle @2026.10.0); inflate with a hard output cap before parsing. */
export function inflateMapData(payload:Uint8Array,maxBytes:number):unknown {
 let raw:Buffer;try{raw=inflateSync(payload,{maxOutputLength:maxBytes});}catch(e){throw new Error((e as {code?:string}).code==='ERR_BUFFER_TOO_LARGE'?'MAP_TOO_LARGE':'INVALID_MAP_DATA');}
 return JSON.parse(raw.toString('utf8'));
}
type Seen<T>={value:T;at:number;retained:boolean};
/**
 * Valetudo Homie layout `<topicPrefix>/<identifier>/...`: commands go to `.../GoToLocationCapability/go/set` and
 * `.../BasicControlCapability/operation/set`, never retained (Valetudo discards retained commands). Status/map arrive retained on subscribe;
 * those deliveries are marked retained and never count as evidence. Broker delivery (PUBACK) is not robot acceptance.
 */
export class MqttTransport implements ValetudoTransport {
 readonly kind='mqtt' as const;
 private base:string;private status?:Seen<string>;private flag?:string;private map?:Seen<ReturnType<typeof parseMap>>;private state?:string;private nodes?:string[];private mapError?:string;private lostAt?:number;
 constructor(private connection:MqttConnection,private profile:Pick<ValetudoProfile,'mqtt'|'maxMapBytes'>,private now:()=>number=Date.now) {
  const t=profile.mqtt ?? (()=>{throw new Error('INVALID_MQTT_TOPIC');})();
  this.base=`${t.topicPrefix}/${t.identifier}`;
  const text=(p:Uint8Array)=>new TextDecoder().decode(p);
  connection.subscribe(`${this.base}/$state`,(_t,p)=>{this.state=text(p);if(this.state!=='ready')this.lostAt??=this.now();}); // Homie LWT: a lost/restarting device latches a gap
  connection.subscribe(`${this.base}/$nodes`,(_t,p)=>{this.nodes=text(p).split(',');});
  connection.subscribe(`${this.base}/StatusStateAttribute/status`,(_t,p,retained)=>{this.status={value:text(p),at:this.now(),retained};});
  connection.subscribe(`${this.base}/StatusStateAttribute/flag`,(_t,p)=>{this.flag=text(p);});
  connection.subscribe(`${this.base}/MapData/map-data`,(_t,p,retained)=>{
   try{this.map={value:parseMap(inflateMapData(p,profile.maxMapBytes)),at:this.now(),retained};this.mapError=undefined;}catch(e){this.mapError=(e as Error).message;this.map=undefined;}
  });
 }
 async capabilities():Promise<string[]> {if(!this.nodes) throw new Error('CAPABILITIES_UNAVAILABLE');return [...this.nodes];}
 private async send(topic:string,payload:string):Promise<boolean> {
  if(!this.connection.connected) return false;
  try{await this.connection.publish(`${this.base}/${topic}`,payload,{qos:1,retain:false});return true;}catch{return false;}
 }
 async goto(_command:RobotCommand,goal:{x:number;y:number}) {
  return await this.send('GoToLocationCapability/go/set',JSON.stringify({coordinates:{x:goal.x,y:goal.y}}))?{ack:'delivered' as const}:{ack:'unknown' as const,reason:'BROKER_UNAVAILABLE'};
 }
 async stop() {return await this.send('BasicControlCapability/operation/set','STOP')?'acknowledged' as const:'unknown' as const;}
 async samples():Promise<ValetudoSample[]> {
  const s=this.status,m=this.map,gap:ValetudoSample[]=this.lostAt!==undefined?[{receivedAtMs:this.lostAt,reachable:false,error:'DEVICE_LOST'}]:[];
  this.lostAt=undefined;
  if(!this.connection.connected||this.state!=='ready'||!s||!m) return [...gap,{receivedAtMs:this.now(),reachable:false,...(this.mapError?{error:this.mapError}:{})}];
  return [...gap,{receivedAtMs:Math.min(s.at,m.at),reachable:true,status:s.value,...(this.flag?{flag:this.flag}:{}),mapFingerprint:m.value.fingerprint,...(m.value.position?{position:m.value.position}:{}),...(m.value.goToTarget?{goToTarget:m.value.goToTarget}:{}),retained:s.retained||m.retained}];
 }
}
