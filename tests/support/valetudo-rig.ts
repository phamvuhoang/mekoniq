import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { deflateSync, gzipSync } from 'node:zlib';
import type { RobotCommand } from '../../packages/contracts/src/index';
import type { RobotEvent } from '../../packages/robot-adapters/src/contract';
import { ValetudoAdapter } from '../../packages/robot-adapters/src/valetudo/adapter';
import type { ValetudoProfile } from '../../packages/robot-adapters/src/valetudo/capabilities';
import { parseMap } from '../../packages/robot-adapters/src/valetudo/map';
import { MqttTransport, type MqttConnection } from '../../packages/robot-adapters/src/valetudo/mqtt';
import { RestTransport } from '../../packages/robot-adapters/src/valetudo/rest';
import robotFixture from '../fixtures/valetudo/robot.json';
import capabilitiesFixture from '../fixtures/valetudo/capabilities.json';
import attributesFixture from '../fixtures/valetudo/state-attributes.json';
import mapFixture from '../fixtures/valetudo/map.json';
/**
 * Protocol emulator for Valetudo 2026.10.0 (REST v2 + Homie MQTT shapes from tests/fixtures/valetudo). It is NOT a robot: it never moves by
 * itself; tests set telemetry explicitly. Results from it are protocol-conformance evidence only (integration_tested at most).
 */
export type Telemetry={status?:string;flag?:string;x?:number;y?:number;angle?:number;mapRevision?:string;goToTarget?:{x:number;y:number}|null;error?:string|null;noPose?:boolean;
 /** Emulator clock of the sample, for the test's own bookkeeping. Valetudo state has no timestamp, so the adapter never sees this. */
 observedAt?:number};
type Goto={x:number;y:number;at:number};
const clone=<T>(v:T):T=>structuredClone(v);
/** In-process MQTT broker stand-in: retained replay on subscribe (flag set), live delivery unflagged, per-client publish ACL by topic prefix. */
export function createFakeBroker() {
 const retained=new Map<string,Uint8Array>(),subs:{filter:string;handler:(t:string,p:Uint8Array,r:boolean)=>void}[]=[];let up=true;
 const matches=(f:string,t:string)=>f===t;
 const deliver=(topic:string,payload:Uint8Array,retain:boolean)=>{if(retain)retained.set(topic,payload);for(const s of subs) if(matches(s.filter,topic)) s.handler(topic,payload,false);};
 const commandHandlers:((topic:string,payload:string,retain:boolean)=>void)[]=[];
 return {
  get up(){return up;},down(){up=false;},restore(){up=true;},
  retainedTopics:()=>[...retained.keys()],
  robotPublish(topic:string,payload:string|Uint8Array,retain=true){deliver(topic,typeof payload==='string'?new TextEncoder().encode(payload):payload,retain);},
  onCommand(handler:(topic:string,payload:string,retain:boolean)=>void){commandHandlers.push(handler);},
  client(aclPrefix:string):MqttConnection {
   return {
    get connected(){return up;},
    async publish(topic,payload,options){
     if(!up) throw new Error('BROKER_DOWN');
     if(!topic.startsWith(aclPrefix)) throw new Error('MQTT_ACL_DENIED');
     for(const h of commandHandlers) h(topic,payload,options.retain);
    },
    subscribe(filter,handler){subs.push({filter,handler});const r=retained.get(filter);if(r) handler(filter,r,true);},
   };
  },
 };
}
export async function createValetudoServer(options:{host?:string;port?:number;topic?:string;now?:()=>number}={}) {
 const now=options.now ?? Date.now,topic=options.topic ?? 'valetudo/EmulatedRobot',broker=createFakeBroker();
 const robot={status:'idle',flag:'none',x:2000,y:1500,angle:90,mapRevision:'r1',goToTarget:undefined as {x:number;y:number}|undefined,error:undefined as string|undefined,noPose:false};
 const lab={gotoMode:'accept' as 'accept'|'reject'|'fail'|'silent',gotoDelayMs:0,unreachable:false,mapPadBytes:0,gotos:[] as Goto[],stops:0,discardedRetained:0,capabilities:capabilitiesFixture as string[],bootAt:now()-3600000};
 const attributes=()=>{const a=clone(attributesFixture) as Record<string,unknown>[];Object.assign(a[0]!,{value:robot.status,flag:robot.flag,...(robot.status==='error'?{error:{severity:{kind:'transient',level:'error'},subsystem:'motors',message:robot.error ?? 'Wheel stuck'}}:{})});return a;};
 const map=()=>{
  const m=clone(mapFixture) as typeof mapFixture & {entities:Record<string,unknown>[];layers:Record<string,unknown>[];metaData:Record<string,unknown>};
  if(robot.mapRevision!=='r1') m.layers.forEach((l,i)=>{(l.metaData as Record<string,unknown>).segmentId=`${robot.mapRevision}-${i}`;});
  m.entities=m.entities.filter(e=>e.type!=='robot_position');
  if(!robot.noPose) m.entities.push({__class:'PointMapEntity',metaData:{angle:robot.angle},points:[robot.x,robot.y],type:'robot_position'});
  if(robot.goToTarget) m.entities.push({__class:'PointMapEntity',metaData:{},points:[robot.goToTarget.x,robot.goToTarget.y],type:'go_to_target'});
  if(lab.mapPadBytes) m.metaData.pad='x'.repeat(lab.mapPadBytes);
  return m;
 };
 const publishState=()=>{ // Valetudo publishes Homie properties retained.
  broker.robotPublish(`${topic}/$state`,'ready');broker.robotPublish(`${topic}/$nodes`,lab.capabilities.join(','));
  broker.robotPublish(`${topic}/StatusStateAttribute/status`,robot.status);broker.robotPublish(`${topic}/StatusStateAttribute/flag`,robot.flag);
  broker.robotPublish(`${topic}/MapData/map-data`,deflateSync(JSON.stringify(map())));
 };
 const applyGoto=(x:number,y:number)=>{lab.gotos.push({x,y,at:now()});};
 broker.onCommand((t,payload,retain)=>{
  if(retain){lab.discardedRetained++;return;} // MqttController @2026.10.0 discards retained commands.
  if(t===`${topic}/GoToLocationCapability/go/set`){const b=JSON.parse(payload);if(lab.gotoMode!=='silent')applyGoto(b.coordinates.x,b.coordinates.y);}
  else if(t===`${topic}/BasicControlCapability/operation/set`&&payload==='STOP') lab.stops++;
 });
 const body=async(req:IncomingMessage)=>{let s='';for await(const c of req)s+=c;return s;};
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url ?? '/','http://x'),send=(status:number,value?:unknown)=>{
   if(value===undefined){res.writeHead(status);res.end(status===200?'OK':'');return;}
   const raw=Buffer.from(JSON.stringify(value)),gzip=String(req.headers['accept-encoding']??'').includes('gzip');
   res.writeHead(status,{'content-type':'application/json',...(gzip?{'content-encoding':'gzip'}:{})});res.end(gzip?gzipSync(raw):raw);
  };
  try {
   if(url.pathname.startsWith('/__lab/')) { // Test-only control surface of the emulator (used by the Android instrumentation test).
    const input=req.method==='POST'?JSON.parse(await body(req) || '{}'):{};
    if(url.pathname==='/__lab/telemetry') {api.telemetry(input);return send(200,{ok:true});}
    if(url.pathname==='/__lab/goto-mode') {lab.gotoMode=input.mode;lab.gotoDelayMs=input.delayMs ?? 0;return send(200,{ok:true});}
    if(url.pathname==='/__lab/unreachable') {lab.unreachable=Boolean(input.on);return send(200,{ok:true});}
    if(url.pathname==='/__lab/reset') {Object.assign(robot,{status:'idle',flag:'none',x:2000,y:1500,mapRevision:'r1',goToTarget:undefined,error:undefined,noPose:false});lab.gotos=[];lab.stops=0;lab.gotoMode='accept';lab.unreachable=false;return send(200,{ok:true});}
    if(url.pathname==='/__lab/counts') return send(200,{gotos:lab.gotos,stops:lab.stops});
    return send(404);
   }
   if(lab.unreachable) {req.socket.destroy();return;}
   if(req.method==='GET'&&url.pathname==='/api/v2/robot') return send(200,robotFixture);
   if(req.method==='GET'&&url.pathname==='/api/v2/system/host/info') return send(200,{hostname:'emulator',arch:'arm',mem:{total:1,free:1,valetudo_current:1,valetudo_max:1},uptime:Math.floor((now()-lab.bootAt)/1000),load:{'1':0,'5':0,'15':0}});
   if(req.method==='GET'&&url.pathname==='/api/v2/robot/capabilities') return send(200,lab.capabilities);
   if(req.method==='GET'&&url.pathname==='/api/v2/robot/state/attributes') return send(200,attributes());
   if(req.method==='GET'&&url.pathname==='/api/v2/robot/state/map') return send(200,map());
   if(req.method==='PUT'&&url.pathname==='/api/v2/robot/capabilities/GoToLocationCapability') {
    const b=JSON.parse(await body(req));
    if(b.action!=='goto'||typeof b.coordinates?.x!=='number'||typeof b.coordinates?.y!=='number') return send(400);
    if(lab.gotoMode==='reject') return send(400);
    applyGoto(b.coordinates.x,b.coordinates.y);
    if(lab.gotoMode==='silent') return; // Goal taken, response never sent (no ACK).
    if(lab.gotoDelayMs) await new Promise(r=>setTimeout(r,lab.gotoDelayMs));
    return send(lab.gotoMode==='fail'?500:200);
   }
   if(req.method==='PUT'&&url.pathname==='/api/v2/robot/capabilities/BasicControlCapability') {
    const b=JSON.parse(await body(req));if(!['start','stop','pause','home'].includes(b.action)) return send(400);
    if(b.action==='stop') lab.stops++;return send(200);
   }
   send(404);
  } catch {if(!res.headersSent)send(500);}
 });
 await new Promise<void>(resolve=>server.listen(options.port ?? 0,options.host ?? '127.0.0.1',resolve));
 const address=server.address() as AddressInfo;
 const api={
  url:`http://${options.host ?? '127.0.0.1'}:${address.port}`,broker,topic,lab,
  /** Valetudo answers the next GoTo with 200 (or, with delayMs, late). 200 only means the firmware took the request. */
  acceptGoto(o:{delayMs?:number}={}){lab.gotoMode='accept';lab.gotoDelayMs=o.delayMs ?? 0;},
  rejectGoto(){lab.gotoMode='reject';},failGoto(){lab.gotoMode='fail';},silentGoto(){lab.gotoMode='silent';},
  telemetry(t:Telemetry){
   if(t.status!==undefined) robot.status=t.status;if(t.flag!==undefined) robot.flag=t.flag;if(t.x!==undefined) robot.x=t.x;if(t.y!==undefined) robot.y=t.y;if(t.angle!==undefined) robot.angle=t.angle;
   if(t.mapRevision!==undefined) robot.mapRevision=t.mapRevision;if(t.goToTarget!==undefined) robot.goToTarget=t.goToTarget ?? undefined;if(t.error!==undefined) robot.error=t.error ?? undefined;if(t.noPose!==undefined) robot.noPose=t.noPose;
   publishState();
  },
  /** Firmware drives toward the last GoTo: moving with go_to_target set. */
  driving(){const g=lab.gotos.at(-1) ?? (()=>{throw new Error('NO_GOTO');})();api.telemetry({status:'moving',flag:'target',goToTarget:{x:g.x,y:g.y}});},
  /** Firmware ends the GoTo idle at (x,y), go_to_target cleared (defaults to the goal itself). */
  idleAt(x?:number,y?:number){const g=lab.gotos.at(-1);api.telemetry({status:'idle',flag:'none',goToTarget:null,x:x ?? g?.x ?? robot.x,y:y ?? g?.y ?? robot.y});},
  /** Host reboot: uptime restarts, the GoTo is gone, the robot comes back docked (Homie $state goes lost then ready). */
  reboot(){lab.bootAt=now();broker.robotPublish(`${topic}/$state`,'lost');api.telemetry({status:'docked',flag:'none',goToTarget:null});},
  unreachable(on=true){lab.unreachable=on;},
  get gotoCount(){return lab.gotos.length;},get stopCount(){return lab.stops;},
  close:()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}),
 };
 publishState();
 return api;
}
export const emulatorFingerprint=()=>parseMap(mapFixture).fingerprint;
export function valetudoProfile(transport:ValetudoProfile['transport'],endpoint:string,overrides:Partial<ValetudoProfile>={}):ValetudoProfile {
 return {robotId:'valetudo-1',transport,endpoint,mqtt:{topicPrefix:'valetudo',identifier:'EmulatedRobot'},mapId:'valetudo-map',mapRevision:'r1',mapFingerprint:emulatorFingerprint(),frame:'valetudo',firmware:'protocol-emulator@valetudo-2026.10.0',validation:'integration_tested',capabilities:['delivery','guide'],maxLoadMinor:'5000',trays:1,offlineExecution:false,
  arriveToleranceM:0.4,goalToleranceCm:5,stationaryCm:5,stationaryMs:2000,freshMs:3000,tripTimeoutMs:120000,requestTimeoutMs:300,maxMapBytes:262144,...overrides};
}
export async function createValetudoRig(options:{transport?:'rest'|'mqtt';profile?:Partial<ValetudoProfile>}={}) {
 const clock={ms:Date.parse('2026-11-01T00:00:00Z')},now=()=>clock.ms;
 const server=await createValetudoServer({now});
 const transportKind=options.transport ?? 'rest',profile=valetudoProfile(transportKind,server.url,options.profile);
 const transport=transportKind==='rest'?new RestTransport(profile,now,{allowLoopback:true}):new MqttTransport(server.broker.client(`${server.topic}/`),profile,now);
 const adapter=new ValetudoAdapter(profile,transport,now),events:RobotEvent[]=[];
 adapter.observe(event=>events.push(event));
 return {
  server,adapter,events,profile,clock,
  advance(ms:number){clock.ms+=ms;},
  /** Advance the clock then run one telemetry round. */
  async tick(ms=1000){clock.ms+=ms;await adapter.poll();},
  types:()=>events.map(e=>e.type),
  command(commandId:string,overrides:Partial<RobotCommand>={}):RobotCommand {
   return {schemaVersion:1,commandId,operationId:`op-${commandId}`,organizationId:'org-a',venueId:'venue-a',robotId:'valetudo-1',missionId:'mission-1',stopId:'stop-1',missionRevision:1,controlEpoch:1,issuerDeviceId:'device-a',issuedAt:new Date(clock.ms).toISOString(),expiresAt:new Date(clock.ms+60000).toISOString(),
    target:{waypointId:'table-1',mapId:'valetudo-map',mapRevision:'r1',frame:'valetudo',x:25,y:12,yaw:0},limits:{trays:1,maxLoadMinor:'5000'},...overrides};
  },
  close:()=>server.close(),
 };
}

// Host side of the Android instrumentation test (tests/android/ValetudoExecutorRecoveryTest.kt), reached from the AVD as 10.0.2.2:
//   VALETUDO_EMULATOR_PORT=18765 pnpm exec tsx tests/support/valetudo-rig.ts
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const server=await createValetudoServer({port:Number(process.env.VALETUDO_EMULATOR_PORT ?? 18765)});
 console.log(JSON.stringify({url:server.url,fingerprint:emulatorFingerprint()}));
 process.on('SIGTERM',()=>{void server.close().then(()=>process.exit(0));});
}
