// Turns case outcomes into AlgorithmResultV1. A missing interpreter is not_run; any other checker failure is fail; neither is ever a pass.
import {hashJson} from '../hash';
import type {AlgorithmResultV1} from '../navigation2d/contracts';
import {isCheckerError,type AlgorithmChecker} from './checker';

export interface Outcome {pass:boolean;metrics:Record<string,number|null>;reasons:string[]}
export type Call=<T>(op:string,payload:unknown)=>Promise<T>;
export const fin=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
export async function collectResults(o:{checker:AlgorithmChecker;checkerId:AlgorithmResultV1['checkerId'];profile:unknown;seed:number;inputs:unknown;cases:[string,(call:Call)=>Promise<Outcome>][]}):Promise<AlgorithmResultV1[]>{
 const oracleProfileDigest=hashJson(o.profile),out:AlgorithmResultV1[]=[];
 for(const [caseId,run] of o.cases){
  const toolVersions:Record<string,string>={},inputDigest=hashJson({caseId,seed:o.seed,profile:o.profile,inputs:o.inputs});
  const call:Call=async<T>(op:string,payload:unknown)=>{const r=await o.checker.call<T>(op,payload);Object.assign(toolVersions,r.toolVersions);return r.result;};
  const base={schemaVersion:1 as const,checkerId:o.checkerId,caseId,oracleProfileDigest,inputDigest};
  try{
   const r=await run(call),metrics=Object.fromEntries(Object.entries(r.metrics).map(([k,v])=>[k,fin(v)?v:null])),bad=Object.values(r.metrics).some(v=>!fin(v));
   out.push({...base,verdict:r.pass&&!bad?'pass':'fail',metrics,toolVersions,reasons:bad?['a metric was not finite',...r.reasons]:r.reasons});
  }catch(e){
   const notInstalled=isCheckerError(e)&&e.code==='CHECKER_NOT_INSTALLED';
   out.push({...base,verdict:notInstalled?'not_run':'fail',metrics:{},toolVersions,reasons:[isCheckerError(e)?`${e.code}: ${e.detail}`:`CHECK_ERROR: ${(e as Error).message}`]});
  }
 }
 return out;
}
