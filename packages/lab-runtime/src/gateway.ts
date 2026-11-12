import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {isIPv4} from 'node:net';
import {createLabSession,type LabSession,type RunAction} from './session';
import {parseJsonStrict} from '../../contracts/src/validate';
import {createV2Gateway,type V2Deps} from './v2/gateway';
import type {CapabilityCatalog} from './v2/capabilities';
export interface LabGateway {url:string;pairingToken:string;issuePairingToken():string;close():Promise<void>;}
export interface GatewayOptions {port?:number;directory:string;sourceCommit:string;schemaHash:string;nowMs?:()=>number;pairingTtlMs?:number;
 /** Listen address, default '127.0.0.1'. Anything but 127.0.0.0/8 or ::1 needs accessKey. */
 bind?:string;
 /** Extra Host values accepted (exact match, lower-cased; include the port when the client sends one). */
 publicHosts?:readonly string[];
 /** Extra Origin values accepted for /lab/v2 only, exact `scheme://host[:port]`; never credentialed. */
 allowOrigins?:readonly string[];
 /** >= 32 characters; /lab/v2/sessions accepts it like the pairing code but never spends it. */
 accessKey?:string;
v2?:{catalog?:CapabilityCatalog;enabledBackends?:readonly string[];stream?:V2Deps['stream'];readinessProbes?:V2Deps['readinessProbes'];nativeChecks?:V2Deps['nativeChecks'];portableChecks?:V2Deps['portableChecks'];simulationFactory?:V2Deps['simulationFactory'];engineering?:V2Deps['engineering']};}
class GatewayError extends Error {constructor(readonly status:number,message:string){super(message);}}
const origins=new Set(['http://127.0.0.1:4175','http://127.0.0.1:4176']);
const loopbackBind=(bind:string)=>bind==='::1'||isIPv4(bind)&&bind.startsWith('127.');
/** `scheme://host[:port]` exactly as a browser serialises it (host lower-cased by URL); anything else is a refusal. */
function allowedOrigin(value:string){
 let url:URL|undefined;try{url=new URL(value);}catch{/* refused below */}
 if(!url||!/^https?:\/\/[^/?#@\s*]+$/i.test(value)||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('INVALID_ALLOW_ORIGIN');
 return url.origin;
}
const token=()=>randomBytes(32).toString('base64url');
const digest=(v:string)=>createHash('sha256').update(v).digest();
const same=(a:string,b:string)=>timingSafeEqual(digest(a),digest(b));
async function body(request:IncomingMessage,maxBytes=1024*1024):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))throw new GatewayError(415,'JSON_REQUIRED');
 const limit=maxBytes;
 if(Number(request.headers['content-length']??0)>limit){request.resume();throw new GatewayError(413,'BODY_TOO_LARGE');}
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size>limit)throw new GatewayError(413,'BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 try{const value:unknown=parseJsonStrict(Buffer.concat(chunks).toString('utf8'),limit);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as Record<string,unknown>;}catch{throw new GatewayError(400,'INVALID_JSON');}
}
export async function startLabGateway(options:GatewayOptions):Promise<LabGateway>{
 const now=options.nowMs??Date.now,bind=options.bind??'127.0.0.1',accessKey=options.accessKey;
 if(accessKey!==undefined&&accessKey.length<32)throw new Error('ACCESS_KEY_TOO_SHORT');
 if(!loopbackBind(bind)&&!accessKey)throw new Error('ACCESS_KEY_REQUIRED');
 // the address this gateway names itself by: a wildcard bind is reached on loopback
 const urlHost=bind==='0.0.0.0'||bind==='::'?'127.0.0.1':bind.includes(':')?`[${bind}]`:bind;
 const configuredOrigins=new Set((options.allowOrigins??[]).map(allowedOrigin)),publicHosts=new Set((options.publicHosts??[]).map(h=>h.toLowerCase()));
 /** The one origin policy: loopback origins are credentialed everywhere; configured origins reach /lab/v2 only and never with credentials. */
 const originPolicy=(origin:string,path:string)=>origins.has(origin)?{credentials:true}:configuredOrigins.has(origin)&&(path==='/lab/v2'||path.startsWith('/lab/v2/'))?{credentials:false}:undefined;
 const hostAllowed=(host:string)=>[`127.0.0.1:${port}`,`${urlHost}:${port}`,'127.0.0.1:4175','127.0.0.1:4176'].includes(host)||publicHosts.has(host.toLowerCase());
 let currentToken='',tokenExpiresAt=0;
 const sessions=new Map<string,{csrf:string;expiresAt:number}>();
 const runs=new Map<string,{owner:string;session:LabSession}>();
 let creatingRuns=0;
 // with an access key it is the only credential: no pairing code is minted, so none can be accepted anywhere
 const issuePairingToken=()=>{if(accessKey)return '';currentToken=token();tokenExpiresAt=now()+(options.pairingTtlMs??300000);return currentToken;};
 const pairingToken=issuePairingToken();
 const pairingValid=(t:unknown)=>typeof t==='string'&&!!currentToken&&now()<tokenExpiresAt&&same(t,currentToken);
 const accessKeyValid=(t:unknown)=>typeof t==='string'&&!!accessKey&&same(t,accessKey);
 const v2=createV2Gateway({directory:options.directory,sourceCommit:options.sourceCommit,schemaHash:options.schemaHash,now,catalog:options.v2?.catalog,enabledBackends:options.v2?.enabledBackends,stream:options.v2?.stream,readinessProbes:options.v2?.readinessProbes,nativeChecks:options.v2?.nativeChecks,portableChecks:options.v2?.portableChecks,simulationFactory:options.v2?.simulationFactory,engineering:options.v2?.engineering,pairingValid,...accessKey?{accessKeyValid}:{},spendPairing(){currentToken='';},same,deployment:{bind:loopbackBind(bind)?'loopback':'public'},readBody:body,send:(r,s,d)=>send(r,s,d)});
 let port=options.port??4176;
 const server=createServer((request,response)=>{void handle(request,response).catch(error=>{
  const message=error instanceof Error?error.message:'INTERNAL_ERROR';
  const code=error instanceof GatewayError?error.status:/CONFLICT|MISMATCH|RECONCILIATION_REQUIRED|INVALID_STATE/.test(message)?409:/^(INVALID_|BACKEND_|SCENARIO_|ACTION_LIMIT|COMMAND_NOT_ALLOWED)/.test(message)?422:500;
  send(response,code,{error:code===500?'RUNTIME_FAILURE':message});
 });});
 const send=(response:ServerResponse,status:number,data:unknown)=>{if(response.writableEnded)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(JSON.stringify(data));};
 async function handle(request:IncomingMessage,response:ServerResponse){
  const host=request.headers.host;
  if(!host||!hostAllowed(host))throw new GatewayError(403,'HOST_FORBIDDEN');
  const origin=request.headers.origin,url=new URL(request.url??'/',`http://${host}`),path=url.pathname,policy=origin?originPolicy(origin,path):undefined;
  if(origin&&!policy)throw new GatewayError(403,'ORIGIN_FORBIDDEN');
  if(origin){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');if(policy!.credentials)response.setHeader('Access-Control-Allow-Credentials','true');}
  if(request.method==='OPTIONS'){
   if(!origin)throw new GatewayError(403,'ORIGIN_REQUIRED');
   response.setHeader('Access-Control-Allow-Methods','GET, POST');response.setHeader('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token, Authorization, Last-Event-ID');response.setHeader('Access-Control-Max-Age','600');return send(response,204,null);
  }
  // the only query accepted: the initial business-event cursor of a v2 stream (EventSource cannot send Last-Event-ID on first connect)
  if(url.search&&path!=='/lab/v2/readiness'&&!(/^\/lab\/v2\/runs\/[0-9a-f-]{36}\/events$/.test(path)&&/^\?after=\d{1,20}$/.test(url.search)))throw new GatewayError(400,'QUERY_UNSUPPORTED');
  if(path==='/lab/v2'||path.startsWith('/lab/v2/'))return v2(request,response,path,origin);
  if(request.method==='GET'&&path==='/lab/v1/health')return send(response,200,{sourceCommit:options.sourceCommit,schemaHash:options.schemaHash,protocolMajor:1,backends:[{id:'business_sim',available:true},{id:'gazebo_sil',available:false,reason:'W06 backend not installed'},{id:'shadow',available:false,reason:'Native read-only telemetry not provisioned'},{id:'hardware_test',available:false,reason:'Native execution is outside this dev-only gateway'}],scenarioIds:['S01'],features:{polling:true,sse:false}});
  if(request.method==='POST'&&!origin)throw new GatewayError(403,'ORIGIN_REQUIRED');
  if(request.method==='POST'&&path==='/lab/v1/sessions'){
   // the legacy API serves the keyless loopback launcher only
   if(accessKey)throw new GatewayError(403,'V1_PAIRING_DISABLED');
   const b=await body(request);
   if(!pairingValid(b.token))throw new GatewayError(401,'PAIRING_INVALID');
   for(const [id,s]of sessions)if(now()>=s.expiresAt)sessions.delete(id);
   if(sessions.size>=10)throw new GatewayError(429,'SESSION_LIMIT');
   currentToken='';const id=token(),csrf=token();sessions.set(id,{csrf,expiresAt:now()+3600000});response.setHeader('Set-Cookie',`mekoniq_lab_session=${id}; HttpOnly; SameSite=Strict; Path=/lab/v1; Max-Age=3600`);return send(response,201,{csrfToken:csrf});
  }
  const cookie=request.headers.cookie??'',match=/(?:^|;\s*)mekoniq_lab_session=([A-Za-z0-9_-]+)/.exec(cookie),sessionId=match?.[1]??'',session=sessions.get(sessionId);
  if(!session||now()>=session.expiresAt)throw new GatewayError(401,'SESSION_REQUIRED');
  if(request.method==='POST'&&!same(String(request.headers['x-csrf-token']??''),session.csrf))throw new GatewayError(403,'CSRF_INVALID');
  if(request.method==='POST'&&path==='/lab/v1/runs'){
   const b=await body(request);
   if(b.sourceCommit!==options.sourceCommit)throw new GatewayError(409,'CONTRACT_MISMATCH');
   if(b.mode!==undefined&&b.mode!=='business_sim')throw new GatewayError(422,'BACKEND_UNAVAILABLE');
   if(runs.size+creatingRuns>=20)throw new GatewayError(429,'RUN_LIMIT');
   // Reserve before any asynchronous fixture/storage work; failed admissions release the slot.
   creatingRuns++;
   let runtime:LabSession|undefined;
   try{
    runtime=await createLabSession({directory:join(options.directory,randomUUID()),project:b.project,sourceCommit:options.sourceCommit,scenarioId:String(b.scenarioId),seed:b.seed as number,mode:'business_sim'});
    const snapshot=await runtime.snapshot();runs.set(snapshot.id,{owner:sessionId,session:runtime});return send(response,201,snapshot);
   }catch(error){await runtime?.close();throw error;}
   finally{creatingRuns--;}
  }
  const route=/^\/lab\/v1\/runs\/([0-9a-f-]{36})(?:\/(actions|report|events))?$/.exec(path),run=route?runs.get(route[1]!):undefined;
  if(!run||run.owner!==sessionId)throw new GatewayError(404,'RUN_NOT_FOUND');
  if(request.method==='GET'&&!route![2])return send(response,200,await run.session.snapshot());
  if(request.method==='GET'&&route![2]==='report')return send(response,200,{...await run.session.report(),schemaHash:options.schemaHash,protocolMajor:1});
  if(request.method==='GET'&&route![2]==='events')throw new GatewayError(501,'SSE_UNAVAILABLE_USE_SNAPSHOT_POLLING');
  if(request.method==='POST'&&route![2]==='actions')return send(response,200,await run.session.action(await body(request) as unknown as RunAction));
  throw new GatewayError(405,'METHOD_NOT_ALLOWED');
 }
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxRequestsPerSocket=1000;
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,bind,()=>resolve());});
 port=(server.address() as {port:number}).port;
 return {url:`http://${urlHost}:${port}`,pairingToken,issuePairingToken,async close(){v2.endStreams();server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await Promise.all([...runs.values()].map(r=>r.session.close()));await v2.close();}};
}
