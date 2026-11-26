// The bench record (K05; contracts §2.3, §2.5, §7): parts written at the end of each session, assembled into one record, read back fail-closed.
// Everything the record says that can be recomputed is recomputed by one function (`derive`) at assembly and again at readback: case verdicts (verdictOf on the
// reloaded traces), gates (gateStatus), measurements, closures, kit, policy, parts, devices, host and worker labels. Only what cannot be recomputed is taken
// as stored: the session's host identity and scan (bound by the part manifests), candidateId, sourceCommit. The directory is read as hostile: readback ends in
// issues, never a throw, and opens only regular files strictly inside it (evidence.ts readers; part, kit and case directories are lstat-checked, never followed).
import {existsSync} from 'node:fs';
import {cp,lstat,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {cpus,platform,release,version} from 'node:os';
import {join} from 'node:path';
import {READ_LIMITS,writeDurable} from '../../lab-runtime/src/v2/navigation2d/evidence';
import {hashJson} from '../../lab-runtime/src/v2/hash';
import {GATES_BENCH,HARDWARE_GATES_BENCH,gateStatus} from '../../../scripts/bench-qualification.mjs';
import {BENCH_CASES,benchCase,verdictOf,type BenchCase,type CaseTrace,type CaseVerdict} from './cases/index';
import {closuresFor} from './closures';
import {sessionAllowsTorque,validateBenchKit,validateBenchPolicy,validateBenchRecord,validateBenchSession,type BenchKitV1,type BenchPolicy,type BenchRecordV1,type BenchSessionV1,
 type HostIdentity,type WorkerIdentity} from './contracts';
import {checkManifest,fileRefs,listFiles,readJsonFile,readManifest,readRegular,readTrace,sha256,writeManifest,writeTrace,type FileRef,type Issue} from './evidence';
export type {Issue} from './evidence';

export type PartKind='identity'|'conformance'|'measure'|'sensors';
const PARTS=['identity','conformance','measure','sensors','compare'] as const,TORQUE=['conformance','measure'];
/** A case in several parts (a measurement session re-runs the first-motion cases): the worst occurrence is the record's status. */
const RANK:Record<CaseVerdict['status'],number>={failed:3,not_run:2,unsupported_by_device:1,tested:0};
const refused=(code:string,detail:string)=>Object.assign(new Error(`${code}: ${detail}`),{code});
const json=(x:unknown)=>JSON.stringify(x,null,1);
const same=(a:unknown,b:unknown)=>hashJson(a??null)===hashJson(b??null);
const codeOf=(e:unknown)=>(e as {code?:string}).code;
const isDir=async(p:string)=>(await lstat(p).catch(()=>null))?.isDirectory()===true;   // a symlink to a directory is not one
/** Spec B1 §5.4: what every bench record differs in from the virtual drive, so nobody compares the wrong things. Fixed; readback compares it. */
export const BENCH_DEVIATIONS:BenchRecordV1['deviations']=[
 {id:'clock',text:'Timeouts run on the host monotonic clock, not on simulated time; every tick records its real time and its lateness against the 20 ms grid.'},
 {id:'no_truth',text:'There is no actual* ground truth from an engine: the drive feedback is the only data.'},
 {id:'velocity',text:'Velocity is the drive\'s own estimate (606Ch), not the virtual drive\'s windowed difference; the position is recorded as well.'},
 {id:'command_seq',text:'commandSeq is the last seq the worker wrote to the bus; a real drive does not know seq.'},
 {id:'stop_and_disable',text:'The quick-stop ramp and coasting or braking on disable are set by the drive\'s parameters, not by the model\'s quickStopSubsteps or onDisable.'}];

/** What every part keeps of its session (`<part>/<part>.json`): host and worker identity (node:os and the worker's describe), what `scan` read on every slave
 * (vendorId, productCode, revision, serial, name, axisId, default PDO maps, requested objects), and the R5 checklist rows of the kit for closuresFor. */
export type SessionExtra={host:Omit<HostIdentity,'testLevel'>;worker:Omit<WorkerIdentity,'busBackend'>;checks:{ruleId:string;path:string;detail:string}[];
 slaves:{position:number;axisId:string;vendorId:string;productCode:string;revision:number|string;serial:string;name:string;rxPdo:string[];txPdo:string[];objects:Record<string,number>}[]};
const str=(x:unknown):x is string=>typeof x==='string';
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
/** The shape derive relies on; anything else in a stored `<part>.json` is RECORD_SCHEMA_INVALID. */
const extraOk=(x:unknown):x is SessionExtra=>obj(x)&&obj(x.host)&&obj(x.worker)&&Array.isArray(x.checks)&&x.checks.every(c=>obj(c)&&str(c.ruleId)&&str(c.path)&&str(c.detail))
 &&Array.isArray(x.slaves)&&x.slaves.every(v=>obj(v)&&str(v.serial)&&str(v.axisId)&&str(v.vendorId)&&str(v.productCode)&&(str(v.revision)||typeof v.revision==='number'));
export function sessionExtra(describe:Record<string,unknown>,scan:Record<string,unknown>,checks:SessionExtra['checks']=[]):SessionExtra{
 const s=(x:unknown)=>typeof x==='string'&&x?x:null;   // nicDriver, nicMacSha256, pysoem: null on the simulated bus; lockDigest null until a lock file exists
 return {host:{os:platform(),kernel:`${release()} ${version()}`.slice(0,200),cpu:cpus()[0]?.model||'unknown',nicDriver:s(describe.nicDriver),nicMacSha256:s(describe.nicMacSha256),
  python:String(describe.python),pysoem:s(describe.pysoem),node:process.version},worker:{protocol:'mekoniq-bench/1',version:String(describe.version),lockSha256:s(describe.lockDigest)},
  checks,slaves:scan.slaves as SessionExtra['slaves']};
}

/** One session's directory: session.json, bench-kit.json, policy.json, `<kind>.json` (extra), cases/<id>/{case.json, ticks-*, cycles-*}, then its own manifest.json.
 * Each stored trace is read back and must give the verdict the session saw (an impure evaluate is caught here). Case ids resolve against `cases`, the production
 * registry unless a test passes its own list; a part written with stand-ins is for that test only (readback and assembly know the production registry alone). */
export async function writeBenchPart(dir:string,kind:PartKind,data:{session:BenchSessionV1;kit:BenchKitV1;policy:BenchPolicy;
 results:{caseId:string;trace:CaseTrace;verdict:CaseVerdict}[];extra?:Record<string,unknown>},cases:readonly BenchCase[]=BENCH_CASES):Promise<void>{
 await mkdir(dir,{recursive:true,mode:0o700});
 if((await readdir(dir)).length)throw refused('PART_DIRECTORY_NOT_EMPTY',dir);
 if(new Set(data.results.map(r=>r.caseId)).size!==data.results.length)throw refused('CASE_DUPLICATE',kind);
 await writeDurable(dir,'session.json',json(data.session));await writeDurable(dir,'bench-kit.json',json(data.kit));await writeDurable(dir,'policy.json',json(data.policy));
 if(data.extra)await writeDurable(dir,`${kind}.json`,json(data.extra));
 for(const r of data.results){
  const c=cases.find(x=>x.id===r.caseId),d=join(dir,'cases',r.caseId);
  if(!c)throw refused('CASE_UNKNOWN',r.caseId);
  await mkdir(d,{recursive:true});await writeTrace(d,r.trace);
  if(!same(verdictOf(c,await readTrace(d),data.kit,data.policy),r.verdict))throw refused('VERDICT_NOT_REPRODUCED',r.caseId);
 }
 await writeManifest(dir);
}

type Derived=Pick<BenchRecordV1,'host'|'worker'|'kit'|'parts'|'policyDigest'|'conditions'|'devices'|'deviations'|'cases'|'gates'|'closures'|'measurements'|'externalGates'>;
/** The recomputable part of a record directory (kit/ plus the part directories present), and every way the parts disagree. */
async function derive(root:string):Promise<{fields:Derived|null;issues:Issue[]}>{
 const issues:Issue[]=[],add=(code:string,path:string)=>issues.push({code,path});
 /** Missing: null (the manifest reports it); unreadable, too large or not JSON: an issue and null. */
 const load=async(rel:string):Promise<unknown>=>{try{return await readJsonFile(join(root,rel));}catch(e){const c=codeOf(e);if(c!=='FILE_MISSING')add(c==='SIZE_MISMATCH'?c:'RECORD_SCHEMA_INVALID',rel);return null;}};
 const kitDir=await isDir(join(root,'kit'));
 const k=validateBenchKit(kitDir?await load('kit/bench-kit.json'):null),p=validateBenchPolicy(kitDir?await load('kit/policy.json'):null);
 if(!k.ok)add('KIT_DIGEST_MISMATCH','kit/bench-kit.json');
 if(!p.ok)add('POLICY_DIGEST_MISMATCH','kit/policy.json');
 if(!k.ok||!p.ok)return {fields:null,issues};
 const {kit}=k,{policy}=p,parts={} as BenchRecordV1['parts'],cases:BenchRecordV1['cases']={},verdicts=new Map<string,CaseVerdict>(),measurements:BenchRecordV1['measurements']=[];
 const loads:Partial<Record<string,BenchSessionV1['declarations']['shaftLoad']>>={};let identity:SessionExtra|null=null;
 for(const kind of PARTS){
  const d=join(root,kind);parts[kind]=null;
  if(!await isDir(d))continue;   // absent, or a link the walk reports as FILE_UNEXPECTED: never followed
  let manifestSha='0'.repeat(64);
  try{
   const files=await readManifest(d);manifestSha=sha256(await readRegular(join(d,'manifest.json'),READ_LIMITS.manifestBytes));
   for(const i of await checkManifest(d,files))add('PART_MANIFEST_MISMATCH',`${kind}/${i.path}`);
  }catch(e){const c=codeOf(e);add(c==='FILE_MISSING'?'PART_MANIFEST_MISMATCH':c==='SIZE_MISMATCH'?c:'RECORD_SCHEMA_INVALID',`${kind}/manifest.json`);}
  const pk=await load(`${kind}/bench-kit.json`) as {digest?:unknown}|null,pp=await load(`${kind}/policy.json`) as {digest?:unknown}|null;
  if(pk?.digest!==kit.digest)add('KIT_DIGEST_MISMATCH',`/parts/${kind}`);
  if(pp?.digest!==policy.digest)add('POLICY_DIGEST_MISMATCH',`/parts/${kind}`);
  const s=validateBenchSession(await load(`${kind}/session.json`));
  if(!s.ok||TORQUE.includes(kind)&&sessionAllowsTorque(s.session,kit).length)add('SESSION_DECLARATION_MISSING',`${kind}/session.json`);
  else loads[kind]=s.session.declarations.shaftLoad;
  const raw=await load(`${kind}/${kind}.json`),extra=extraOk(raw)?raw:null,serials=(x:SessionExtra|null)=>x?x.slaves.map(v=>v.serial).sort().join('\n'):null;
  if(raw!==null&&!extra)add('RECORD_SCHEMA_INVALID',`${kind}/${kind}.json`);
  if(kind==='identity')identity=extra;
  if(serials(extra)===null||serials(extra)!==serials(identity))add('SERIAL_SET_MISMATCH',`/parts/${kind}`);
  parts[kind]={manifestSha256:manifestSha,kitDigest:kit.digest};   // a part on another kit is KIT_DIGEST_MISMATCH above
  const ids=await isDir(join(d,'cases'))?(await readdir(join(d,'cases'))).sort():[];
  for(const id of ids){
   const cd=join(d,'cases',id);
   if(!await isDir(cd))continue;
   let v:CaseVerdict;
   try{const c=benchCase(id);if(!c)throw refused('CASE_UNKNOWN',id);v=verdictOf(c,await readTrace(cd),kit,policy);}
   catch(e){   // spec §7: not recomputable is failed
    const c=codeOf(e);if(c==='RECORD_SCHEMA_INVALID'||c==='SIZE_MISMATCH'||c==='CASE_UNKNOWN')add(c,`${kind}/cases/${id}`);   // an id outside the production registry never assembles or verifies
    v={status:'failed',reason:`VERDICT_NOT_REPRODUCIBLE ${e instanceof Error?e.message:String(e)}`.slice(0,500),measurements:[]};
   }
   // each occurrence recomputed from its own traces; the worst one (the first of equals) gives status, reason and session, the artifacts cover every occurrence
   const artifacts=(await listFiles(cd)).map(f=>`${kind}/cases/${id}/${f}`),had=cases[id];
   measurements.push(...v.measurements.map(m=>({...m,part:kind})));
   if(had&&RANK[had.status]>=RANK[v.status]){had.artifacts.push(...artifacts);continue;}
   verdicts.set(id,v);cases[id]={status:v.status,reason:v.reason,session:kind,artifacts:[...had?.artifacts??[],...artifacts]};
  }
 }
 if(!identity){add('SERIAL_SET_MISMATCH','identity/identity.json');return {fields:null,issues};}
 for(const g of HARDWARE_GATES_BENCH)for(const id of GATES_BENCH[g]!)cases[id]??={status:'not_run',reason:'NOT_RECORDED',session:null,artifacts:[]};
 const testLevel=kit.bus.backend==='sim'?'protocol_double' as const:'hardware' as const;   // derived from the sealed kit, never declared
 return {issues,fields:{host:{...identity.host,testLevel},worker:{...identity.worker,busBackend:kit.bus.backend},kit:{id:kit.id,revision:kit.revision,digest:kit.digest},parts,
  policyDigest:policy.digest,conditions:{shaftLoad:loads.conformance??loads.measure??loads.identity??'bare',busMode:kit.bus.mode,cycleMs:kit.bus.cycleMs,sync:kit.bus.sync},
  devices:identity.slaves.map(s=>({deviceId:s.axisId,profileId:kit.axes.find(a=>a.axisId===s.axisId)?.profile.id??'',vendorId:s.vendorId,productCode:s.productCode,revision:String(s.revision),serial:s.serial,firmware:null})),
  deviations:BENCH_DEVIATIONS,cases,gates:Object.fromEntries(HARDWARE_GATES_BENCH.map(g=>[g,{status:gateStatus(g,cases,{testLevel}),accepted:false as const}])),
  closures:closuresFor(identity.checks,verdicts,kit),measurements,
  externalGates:{'G-SAFE1':{status:'blocked_external',accepted:false}}}};
}

/** Copies the parts into `out` (which must not exist), refuses parts that do not belong together (the first issue's code is thrown), writes bench-record.json and
 * the record manifest. On any refusal `out` is removed. */
export async function assembleBenchRecord(parts:Partial<Record<PartKind|'compare',string>>&{identity:string},out:string,o:{candidateId:string;sourceCommit:string}):Promise<BenchRecordV1>{
 if(existsSync(out))throw refused('OUTPUT_EXISTS',out);
 await mkdir(out,{recursive:true,mode:0o700});
 try{
  for(const kind of PARTS)if(parts[kind])await cp(parts[kind],join(out,kind),{recursive:true,errorOnExist:true,force:false});
  await mkdir(join(out,'kit'));
  for(const f of ['bench-kit.json','policy.json'])await writeDurable(join(out,'kit'),f,await readFile(join(out,'identity',f)));
  const {fields,issues}=await derive(out);
  if(!fields||issues.length)throw refused(issues[0]?.code??'RECORD_SCHEMA_INVALID',issues[0]?.path??out);
  const record:BenchRecordV1={schemaVersion:1,documentType:'bench-record',accepted:false,hardwareValidated:false,controlAuthority:false,candidateId:o.candidateId,sourceCommit:o.sourceCommit,
   ...fields,artifacts:await fileRefs(out)};
  const v=validateBenchRecord(record);
  if(!v.ok)throw refused('RECORD_SCHEMA_INVALID',v.problems.map(x=>`${x.code} ${x.path}`).join('; '));
  await writeDurable(out,'bench-record.json',json(record));await writeManifest(out);
  return record;
 }catch(e){await rm(out,{recursive:true,force:true});throw e;}
}

const FIELD_CODES:[keyof Derived,string][]=[['kit','KIT_DIGEST_MISMATCH'],['policyDigest','POLICY_DIGEST_MISMATCH'],['parts','PART_MANIFEST_MISMATCH'],['devices','SERIAL_SET_MISMATCH'],
 ['gates','GATE_TABLE_MISMATCH'],['measurements','GATE_TABLE_MISMATCH'],['closures','GATE_TABLE_MISMATCH'],['deviations','GATE_TABLE_MISMATCH'],['externalGates','EXTERNAL_GATES_MISMATCH'],
 ['host','RECORD_SCHEMA_INVALID'],['worker','RECORD_SCHEMA_INVALID'],['conditions','RECORD_SCHEMA_INVALID']];
/** Readback: the manifest against the files, the record against its schema, then every recomputable field against `derive`. Nothing is trusted because it is stored.
 * It never throws about the directory's contents: anything unforeseen is RECORD_SCHEMA_INVALID at '/'. */
export async function verifyBenchRecord(dir:string):Promise<{ok:boolean;issues:Issue[]}>{
 try{return await verify(dir);}catch{return {ok:false,issues:[{code:'RECORD_SCHEMA_INVALID',path:'/'}]};}
}
async function verify(dir:string):Promise<{ok:boolean;issues:Issue[]}>{
 let files:FileRef[];
 try{files=await readManifest(dir);}
 catch(e){const c=codeOf(e);return {ok:false,issues:[{code:c==='FILE_MISSING'||c==='SIZE_MISMATCH'?c:'RECORD_SCHEMA_INVALID',path:'manifest.json'}]};}
 const issues=await checkManifest(dir,files),v=validateBenchRecord(await readJsonFile(join(dir,'bench-record.json')).catch(()=>null));
 if(!v.ok)return {ok:false,issues:[...issues,...v.problems.map(p=>({code:p.path.startsWith('/externalGates')?'EXTERNAL_GATES_MISMATCH':'RECORD_SCHEMA_INVALID',path:p.path}))]};
 const r=v.record,{fields,issues:more}=await derive(dir);
 issues.push(...more);
 if(fields){
  for(const id of new Set([...Object.keys(r.cases),...Object.keys(fields.cases)]))if(!same(r.cases[id],fields.cases[id]))issues.push({code:'VERDICT_NOT_REPRODUCED',path:`/cases/${id}`});
  for(const [k,code] of FIELD_CODES)if(!same(r[k],fields[k]))issues.push({code,path:`/${k}`});
 }
 if(!same(r.artifacts,files.filter(f=>f.path!=='bench-record.json')))issues.push({code:'CHECKSUM_MISMATCH',path:'/artifacts'});
 return {ok:!issues.length,issues};
}
