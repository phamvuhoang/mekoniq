// One-shot Python algorithm checker (mekoniq-algorithm/1): JSON line on stdin, one JSON line on stdout. Same shape as the LinkForge validator:
// fixed argv through the isolated bootstrap, an allowlisted environment, a private working directory and a deadline that kills the process group.
// The checker only computes values; every comparison and verdict lives in TypeScript.
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp as mkdtempP,rm as rmP} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedPythonArgs} from '../../engineering/python-env';
import {hashJson} from '../hash';
import oracleProfileJson from '../../../../../robotics/algorithm/oracle-profile-v1.json';
export const ALGORITHM_PROTOCOL='mekoniq-algorithm/1';
export const MAX_REQUEST_BYTES=1<<20;
export interface OracleProfileV1 {version:1;note?:string;fk:{translationM:number;rotationRad:number};ikTsToRtb:{translationM:number;rotationRad:number};ikRtbToTs:{translationM:number;rotationRad:number};ikPoses:number;ikSolvedFractionMin:number;
 jacobian:{normalized:number;conditionRelative:number};singularConditionMax:number;seededPoses:number;pid:{sample:number};
 webots?:{lidarRangeToleranceM:number;lidarWindowBeams:number;lidarMedianM:number;repeatPoseM:number};
 webotsArm?:{reachTolRad:number;settleTicks:number;followTolRad:number;followTicks:number;repeatJointRad:number;note?:string}}
export const REPO_ROOT=fileURLToPath(new URL('../../../../../',import.meta.url));
/** The versioned thresholds. The digest is over the canonical JSON, so whitespace edits do not change a recorded identity. Without a path: the profile compiled into the runtime (the exported Lab artifact carries no robotics/ tree, so a file read would find nothing there). */
export function loadOracleProfile(path?:string):{profile:OracleProfileV1;digest:string}{
 const profile=(path?JSON.parse(readFileSync(path,'utf8')):structuredClone(oracleProfileJson)) as OracleProfileV1;
 return {profile,digest:hashJson(profile)};
}
export interface AlgorithmCheckerOptions {python:string;root:string;timeoutMs?:number;/** Test seam, like the IR-SIM `entry` doubles: replaces `-m algorithm_checks`. */entry?:string[]}
export type AlgorithmCheckerCode='CHECKER_NOT_INSTALLED'|'CHECKER_TIMEOUT'|'CHECKER_PROTOCOL'|'CHECKER_REJECTED';
export class AlgorithmCheckerError extends Error {
 constructor(readonly code:AlgorithmCheckerCode,readonly detail:string){super(`${code}: ${detail}`);this.name='AlgorithmCheckerError';}
}
/** By name, not instanceof: the CLI loads each TypeScript module through its own loader, so the class can exist twice and an instanceof check would misreport a missing venv as a failure. */
export const isCheckerError=(e:unknown):e is AlgorithmCheckerError=>e instanceof Error&&e.name==='AlgorithmCheckerError';
export interface AlgorithmChecker {call<T>(op:string,payload:unknown):Promise<{result:T;toolVersions:Record<string,string>}>}
export function createAlgorithmChecker(o:AlgorithmCheckerOptions):AlgorithmChecker{
 const timeoutMs=o.timeoutMs??30_000;
 return {
  async call<T>(op:string,payload:unknown){
   const request=JSON.stringify({protocol:ALGORITHM_PROTOCOL,op,payload});
   if(Buffer.byteLength(request)>MAX_REQUEST_BYTES)throw new AlgorithmCheckerError('CHECKER_REJECTED',`INPUT_TOO_LARGE: request exceeds ${MAX_REQUEST_BYTES} bytes`);
   const cwd=await mkdtempP(join(tmpdir(),'alg-check-'));
   try{
    const out=await new Promise<{stdout:string;stderr:string;code:number|null;timedOut:boolean;missing:boolean}>(done=>{
     const child=spawn(o.python,isolatedPythonArgs([resolve(o.root)],o.entry??['-m','algorithm_checks']),{cwd,detached:true,stdio:['pipe','pipe','pipe'],
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:cwd,MPLCONFIGDIR:cwd,MPLBACKEND:'Agg'} as unknown as NodeJS.ProcessEnv});
     let stdout='',stderr='',timedOut=false,missing=false;
     const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid!,'SIGKILL');}catch{child.kill('SIGKILL');}},timeoutMs);
     child.stdout.on('data',d=>{stdout+=d;if(stdout.length>MAX_REQUEST_BYTES*4)child.kill('SIGKILL');});child.stderr.on('data',d=>{stderr=(stderr+d).slice(-2000);});
     child.on('error',e=>{missing=(e as NodeJS.ErrnoException).code==='ENOENT';clearTimeout(timer);done({stdout,stderr:String(e),code:null,timedOut,missing});});
     child.on('close',code=>{clearTimeout(timer);done({stdout,stderr,code,timedOut,missing});});
     child.stdin.on('error',()=>{});child.stdin.end(request);
    });
    if(out.missing)throw new AlgorithmCheckerError('CHECKER_NOT_INSTALLED',`cannot start ${o.python}`);
    if(out.timedOut)throw new AlgorithmCheckerError('CHECKER_TIMEOUT',`no answer within ${timeoutMs} ms; the process group was killed`);
    if(/No module named '(algorithm_checks|roboticstoolbox|numpy|scipy)'/.test(out.stderr))throw new AlgorithmCheckerError('CHECKER_NOT_INSTALLED',out.stderr.trim().split('\n').at(-1)??'module missing');
    const lines=out.stdout.split('\n').filter(l=>l.trim());
    if(out.code!==0||lines.length!==1)throw new AlgorithmCheckerError('CHECKER_PROTOCOL',`exit ${out.code}, ${lines.length} output lines. ${out.stderr.trim().split('\n').at(-1)??''}`.trim());
    let r:{ok?:boolean;result?:T;toolVersions?:Record<string,string>;error?:{code:string;message:string}};
    try{r=JSON.parse(lines[0]!);}catch{throw new AlgorithmCheckerError('CHECKER_PROTOCOL','the answer is not JSON');}
    if(r.ok===false&&r.error)throw new AlgorithmCheckerError('CHECKER_REJECTED',`${r.error.code}: ${r.error.message}`);
    if(r.ok!==true||r.result===undefined||!r.toolVersions)throw new AlgorithmCheckerError('CHECKER_PROTOCOL','the answer has neither ok:true with a result nor an error');
    return {result:r.result,toolVersions:r.toolVersions};
   }finally{await rmP(cwd,{recursive:true,force:true});}
  },
 };
}
