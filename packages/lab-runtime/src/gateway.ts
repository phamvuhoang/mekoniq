import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,createHash,timingSafeEqual,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {createLabSession,type LabSession,type RunAction} from './session';
import {parseJsonStrict} from '../../contracts/src/validate';
export interface LabGateway {url:string;pairingToken:string;issuePairingToken():string;close():Promise<void>;}
export interface GatewayOptions {port?:number;directory:string;sourceCommit:string;schemaHash:string;nowMs?:()=>number;pairingTtlMs?:number;}
class GatewayError extends Error {constructor(readonly status:number,message:string){super(message);}}
const origins=new Set(['http://127.0.0.1:4175','http://127.0.0.1:4176']);
const token=()=>randomBytes(32).toString('base64url');
const digest=(v:string)=>createHash('sha256').update(v).digest();
const same=(a:string,b:string)=>timingSafeEqual(digest(a),digest(b));
async function body(request:IncomingMessage):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))throw new GatewayError(415,'JSON_REQUIRED');
 const limit=1024*1024;
 if(Number(request.headers['content-length']??0)>limit){request.resume();throw new GatewayError(413,'BODY_TOO_LARGE');}
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of request){size+=chunk.length;if(size>limit)throw new GatewayError(413,'BODY_TOO_LARGE');chunks.push(Buffer.from(chunk));}
 try{const value:unknown=parseJsonStrict(Buffer.concat(chunks).toString('utf8'),limit);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value as Record<string,unknown>;}catch{throw new GatewayError(400,'INVALID_JSON');}
}
export async function startLabGateway(options:GatewayOptions):Promise<LabGateway>{
 const now=options.nowMs??Date.now;
 let currentToken='',tokenExpiresAt=0;
 const sessions=new Map<string,{csrf:string;expiresAt:number}>();
 const runs=new Map<string,{owner:string;session:LabSession}>();
 const issuePairingToken=()=>{currentToken=token();tokenExpiresAt=now()+(options.pairingTtlMs??300000);return currentToken;};
 const pairingToken=issuePairingToken();
 let port=options.port??4176;
 const server=createServer((request,response)=>{void handle(request,response).catch(error=>{
  const message=error instanceof Error?error.message:'INTERNAL_ERROR';
  const code=error instanceof GatewayError?error.status:/CONFLICT|MISMATCH|RECONCILIATION_REQUIRED|INVALID_STATE/.test(message)?409:/^(INVALID_|BACKEND_|SCENARIO_|ACTION_LIMIT|COMMAND_NOT_ALLOWED)/.test(message)?422:500;
  send(response,code,{error:code===500?'RUNTIME_FAILURE':message});
 });});
 const send=(response:ServerResponse,status:number,data:unknown)=>{if(response.writableEnded)return;response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});response.end(JSON.stringify(data));};
 async function handle(request:IncomingMessage,response:ServerResponse){
  const host=request.headers.host;
  if(!host||![`127.0.0.1:${port}`,'127.0.0.1:4175','127.0.0.1:4176'].includes(host))throw new GatewayError(403,'HOST_FORBIDDEN');
  const origin=request.headers.origin;
  if(origin&&!origins.has(origin))throw new GatewayError(403,'ORIGIN_FORBIDDEN');
  if(origin){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');response.setHeader('Access-Control-Allow-Credentials','true');}
  if(request.method==='OPTIONS'){
   if(!origin)throw new GatewayError(403,'ORIGIN_REQUIRED');
   response.setHeader('Access-Control-Allow-Methods','GET, POST');response.setHeader('Access-Control-Allow-Headers','Content-Type, X-CSRF-Token');return send(response,204,null);
  }
  const url=new URL(request.url??'/',`http://${host}`),path=url.pathname;
  if(url.search)throw new GatewayError(400,'QUERY_UNSUPPORTED');
  if(request.method==='GET'&&path==='/lab/v1/health')return send(response,200,{sourceCommit:options.sourceCommit,schemaHash:options.schemaHash,protocolMajor:1,backends:[{id:'business_sim',available:true},{id:'gazebo_sil',available:false,reason:'W06 backend not installed'},{id:'shadow',available:false,reason:'Native read-only telemetry not provisioned'},{id:'hardware_test',available:false,reason:'Native execution is outside this dev-only gateway'}],scenarioIds:['S01'],features:{polling:true,sse:false}});
  if(request.method==='POST'&&!origin)throw new GatewayError(403,'ORIGIN_REQUIRED');
  if(request.method==='POST'&&path==='/lab/v1/sessions'){
   const b=await body(request);
   if(typeof b.token!=='string'||!currentToken||now()>=tokenExpiresAt||!same(b.token,currentToken))throw new GatewayError(401,'PAIRING_INVALID');
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
   if(runs.size>=20)throw new GatewayError(429,'RUN_LIMIT');
   const runtime=await createLabSession({directory:join(options.directory,randomUUID()),project:b.project,sourceCommit:options.sourceCommit,scenarioId:String(b.scenarioId),seed:b.seed as number,mode:'business_sim'});
   const snapshot=await runtime.snapshot();runs.set(snapshot.id,{owner:sessionId,session:runtime});return send(response,201,snapshot);
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
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve());});
 port=(server.address() as {port:number}).port;
 return {url:`http://127.0.0.1:${port}`,pairingToken,issuePairingToken,async close(){server.closeIdleConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await Promise.all([...runs.values()].map(r=>r.session.close()));}};
}
