import type {LabProject,RunSnapshot} from '../shared/types';
import {verifyRuntime,type RuntimeIdentity} from './compatibility';
export interface Health extends RuntimeIdentity {backends:{id:string;available:boolean;reason?:string}[];[key:string]:unknown;}
let csrfToken='';
let health:Health|undefined;
let identity:RuntimeIdentity|undefined;
export class RuntimeError extends Error {
 constructor(readonly code:string,readonly status:number) {super(code);this.name='RuntimeError';}
}
async function request<T>(path:string,body?:unknown):Promise<T> {
 const response=await fetch(`/lab/v1${path}`,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?{}:{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const payload=await response.json().catch(()=>({error:'INVALID_RUNTIME_RESPONSE'}));
 if(!response.ok) throw new RuntimeError(String(payload.code??payload.error??'RUNTIME_REQUEST_FAILED'),response.status);
 return payload as T;
}
export async function getHealth():Promise<Health> {health=await request<Health>('/health');return health;}
export async function pair(token:string):Promise<void> {
 const result=await request<{csrfToken:string}>('/sessions',{token});
 if(!result.csrfToken) throw new RuntimeError('INVALID_PAIRING_RESPONSE',502);
 csrfToken=result.csrfToken;
}
async function pinnedIdentity():Promise<RuntimeIdentity> {
 if(identity)return identity;
 const response=await fetch('/source-runtime.lock.json');
 if(!response.ok) throw new RuntimeError('RUNTIME_LOCK_MISSING',409);
 identity=await response.json() as RuntimeIdentity;
 return identity;
}
export async function createRun(project:LabProject,scenarioId='S01',seed=1):Promise<RunSnapshot> {
 const [lock,current]=await Promise.all([pinnedIdentity(),getHealth()]);
 const verified=verifyRuntime(lock,current);
 if(!verified.ok) throw new RuntimeError(verified.reasons.join(','),409);
 return request<RunSnapshot>('/runs',{project,scenarioId,seed,sourceCommit:lock.sourceCommit,mode:'business_sim'});
}
export async function action(runId:string,kind:string,payload:Record<string,unknown>={},expectedRevision?:number):Promise<RunSnapshot> {
 return request<RunSnapshot>(`/runs/${encodeURIComponent(runId)}/actions`,{actionId:crypto.randomUUID(),kind,payload,...(expectedRevision===undefined?{}:{expectedRevision})});
}
export function getRun(runId:string):Promise<RunSnapshot> {return request(`/runs/${encodeURIComponent(runId)}`);}
export function getReport(runId:string):Promise<Record<string,unknown>> {return request(`/runs/${encodeURIComponent(runId)}/report`);}
