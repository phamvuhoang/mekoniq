// The bench record (K05; contracts §2.3, §2.5, §7): parts written at the end of each session, assembled into one record, read back fail-closed.
// Everything the record says that can be recomputed is recomputed by one function (`derive`) at assembly and again at readback: case verdicts (verdictOf on the
// reloaded traces), gates (gateStatus), measurements, closures, kit, policy, parts, devices, host and worker labels. Only what cannot be recomputed is taken
// as stored: the session's host identity and scan (bound by the part manifests), candidateId, sourceCommit, deviations.
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {cp,mkdir,readdir,readFile,rm} from 'node:fs/promises';
import {cpus,platform,release,version} from 'node:os';
import {join} from 'node:path';
import {writeDurable} from '../../lab-runtime/src/v2/navigation2d/evidence';
import {hashJson} from '../../lab-runtime/src/v2/hash';
import {GATES_BENCH,HARDWARE_GATES_BENCH,gateStatus} from '../../../scripts/bench-qualification.mjs';
import {benchCase,verdictOf,type CaseTrace,type CaseVerdict} from './cases/index';
import {closuresFor} from './closures';
import {sessionAllowsTorque,validateBenchKit,validateBenchPolicy,validateBenchRecord,validateBenchSession,type BenchKitV1,type BenchPolicy,type BenchRecordV1,type BenchSessionV1,
 type HostIdentity,type WorkerIdentity} from './contracts';
import {checkManifest,fileRefs,listFiles,readTrace,writeManifest,writeTrace,type FileRef,type Issue} from './evidence';
export type {Issue} from './evidence';

export type PartKind='identity'|'conformance'|'measure'|'sensors';
const PARTS=['identity','conformance','measure','sensors','compare'] as const,TORQUE=['conformance','measure'];
const refused=(code:string,detail:string)=>Object.assign(new Error(`${code}: ${detail}`),{code});
const json=(x:unknown)=>JSON.stringify(x,null,1);
const readJson=async<T>(p:string):Promise<T|null>=>{try{return JSON.parse(await readFile(p,'utf8')) as T;}catch{return null;}};
const same=(a:unknown,b:unknown)=>hashJson(a??null)===hashJson(b??null);

/** What every part keeps of its session (`<part>/<part>.json`): host and worker identity (node:os and the worker's describe), what `scan` read on every slave
 * (vendorId, productCode, revision, serial, name, axisId, default PDO maps, requested objects), and the R5 checklist rows of the kit for closuresFor. */
export type SessionExtra={host:Omit<HostIdentity,'testLevel'>;worker:Omit<WorkerIdentity,'busBackend'>;checks:{ruleId:string;path:string;detail:string}[];
 slaves:{position:number;axisId:string;vendorId:string;productCode:string;revision:number|string;serial:string;name:string;rxPdo:string[];txPdo:string[];objects:Record<string,number>}[]};
export function sessionExtra(describe:Record<string,unknown>,scan:Record<string,unknown>,checks:SessionExtra['checks']=[]):SessionExtra{
 const s=(x:unknown)=>typeof x==='string'&&x?x:null;   // nicDriver, nicMacSha256, pysoem: null on the simulated bus; lockDigest null until a lock file exists
 return {host:{os:platform(),kernel:`${release()} ${version()}`.slice(0,200),cpu:cpus()[0]?.model||'unknown',nicDriver:s(describe.nicDriver),nicMacSha256:s(describe.nicMacSha256),
  python:String(describe.python),pysoem:s(describe.pysoem),node:process.version},worker:{protocol:'mekoniq-bench/1',version:String(describe.version),lockSha256:s(describe.lockDigest)},
  checks,slaves:scan.slaves as SessionExtra['slaves']};
}

/** One session's directory: session.json, bench-kit.json, policy.json, `<kind>.json` (extra), cases/<id>/{case.json, ticks-*, cycles-*}, then its own manifest.json.
 * Each stored trace is read back and must give the verdict the session saw (an impure evaluate is caught here). */
export async function writeBenchPart(dir:string,kind:PartKind,data:{session:BenchSessionV1;kit:BenchKitV1;policy:BenchPolicy;
 results:{caseId:string;trace:CaseTrace;verdict:CaseVerdict}[];extra?:Record<string,unknown>}):Promise<void>{
 await mkdir(dir,{recursive:true,mode:0o700});
 if((await readdir(dir)).length)throw refused('PART_DIRECTORY_NOT_EMPTY',dir);
 if(new Set(data.results.map(r=>r.caseId)).size!==data.results.length)throw refused('CASE_DUPLICATE',kind);
 await writeDurable(dir,'session.json',json(data.session));await writeDurable(dir,'bench-kit.json',json(data.kit));await writeDurable(dir,'policy.json',json(data.policy));
 if(data.extra)await writeDurable(dir,`${kind}.json`,json(data.extra));
 for(const r of data.results){
  const c=benchCase(r.caseId),d=join(dir,'cases',r.caseId);
  if(!c)throw refused('CASE_UNKNOWN',r.caseId);
  await mkdir(d,{recursive:true});await writeTrace(d,r.trace);
  if(!same(verdictOf(c,await readTrace(d),data.kit,data.policy),r.verdict))throw refused('VERDICT_NOT_REPRODUCED',r.caseId);
 }
 await writeManifest(dir);
}

type Derived=Pick<BenchRecordV1,'host'|'worker'|'kit'|'parts'|'policyDigest'|'conditions'|'devices'|'cases'|'gates'|'closures'|'measurements'|'externalGates'>;
/** The recomputable part of a record directory (kit/ plus the part directories present), and every way the parts disagree. */
async function derive(root:string):Promise<{fields:Derived|null;issues:Issue[]}>{
 const issues:Issue[]=[],add=(code:string,path:string)=>issues.push({code,path});
 const k=validateBenchKit(await readJson(join(root,'kit/bench-kit.json'))),p=validateBenchPolicy(await readJson(join(root,'kit/policy.json')));
 if(!k.ok)add('KIT_DIGEST_MISMATCH','kit/bench-kit.json');
 if(!p.ok)add('POLICY_DIGEST_MISMATCH','kit/policy.json');
 if(!k.ok||!p.ok)return {fields:null,issues};
 const {kit}=k,{policy}=p,parts={} as BenchRecordV1['parts'],cases:BenchRecordV1['cases']={},verdicts=new Map<string,CaseVerdict>();
 const loads:Partial<Record<string,BenchSessionV1['declarations']['shaftLoad']>>={};let identity:SessionExtra|null=null;
 for(const kind of PARTS){
  const d=join(root,kind);parts[kind]=null;
  if(!existsSync(d))continue;
  const manifest=await readFile(join(d,'manifest.json')).catch(()=>null),files=(manifest&&(JSON.parse(manifest.toString('utf8')) as {files?:FileRef[]}).files)||[];
  if(!manifest)add('PART_MANIFEST_MISMATCH',`${kind}/manifest.json`);
  for(const i of await checkManifest(d,files))add('PART_MANIFEST_MISMATCH',`${kind}/${i.path}`);
  const pk=await readJson<BenchKitV1>(join(d,'bench-kit.json')),pp=await readJson<BenchPolicy>(join(d,'policy.json'));
  if(pk?.digest!==kit.digest)add('KIT_DIGEST_MISMATCH',`/parts/${kind}`);
  if(pp?.digest!==policy.digest)add('POLICY_DIGEST_MISMATCH',`/parts/${kind}`);
  const s=validateBenchSession(await readJson(join(d,'session.json')));
  if(!s.ok||TORQUE.includes(kind)&&sessionAllowsTorque(s.session,kit).length)add('SESSION_DECLARATION_MISSING',`${kind}/session.json`);
  else loads[kind]=s.session.declarations.shaftLoad;
  const extra=await readJson<SessionExtra>(join(d,`${kind}.json`)),serials=(x:SessionExtra|null)=>Array.isArray(x?.slaves)?x.slaves.map(v=>v.serial).sort().join('\n'):null;
  if(kind==='identity')identity=extra;
  if(serials(extra)===null||serials(extra)!==serials(identity))add('SERIAL_SET_MISMATCH',`/parts/${kind}`);
  parts[kind]={manifestSha256:manifest?createHash('sha256').update(manifest).digest('hex'):'0'.repeat(64),kitDigest:typeof pk?.digest==='string'&&/^[0-9a-f]{64}$/.test(pk.digest)?pk.digest:'0'.repeat(64)};
  for(const id of (await readdir(join(d,'cases')).catch(()=>[] as string[])).sort()){
   let v:CaseVerdict;
   try{const c=benchCase(id);if(!c)throw refused('CASE_UNKNOWN',id);v=verdictOf(c,await readTrace(join(d,'cases',id)),kit,policy);}
   catch(e){v={status:'failed',reason:`VERDICT_NOT_REPRODUCIBLE ${e instanceof Error?e.message:String(e)}`.slice(0,500),measurements:[]};}   // spec §7: not recomputable is failed
   if(cases[id])add('VERDICT_NOT_REPRODUCED',`/cases/${id}`);   // one case, one session
   verdicts.set(id,v);cases[id]={status:v.status,reason:v.reason,session:kind,artifacts:(await listFiles(join(d,'cases',id))).map(f=>`${kind}/cases/${id}/${f}`)};
  }
 }
 if(!identity||!Array.isArray(identity.slaves)){add('SERIAL_SET_MISMATCH','identity/identity.json');return {fields:null,issues};}
 for(const g of HARDWARE_GATES_BENCH)for(const id of GATES_BENCH[g]!)cases[id]??={status:'not_run',reason:'NOT_RECORDED',session:null,artifacts:[]};
 const testLevel=kit.bus.backend==='sim'?'protocol_double' as const:'hardware' as const;   // derived from the sealed kit, never declared
 return {issues,fields:{host:{...identity.host,testLevel},worker:{...identity.worker,busBackend:kit.bus.backend},kit:{id:kit.id,revision:kit.revision,digest:kit.digest},parts,
  policyDigest:policy.digest,conditions:{shaftLoad:loads.conformance??loads.measure??loads.identity??'bare',busMode:kit.bus.mode,cycleMs:kit.bus.cycleMs,sync:kit.bus.sync},
  devices:identity.slaves.map(s=>({deviceId:s.axisId,profileId:kit.axes.find(a=>a.axisId===s.axisId)?.profile.id??'',vendorId:s.vendorId,productCode:s.productCode,revision:String(s.revision),serial:s.serial,firmware:null})),
  cases,gates:Object.fromEntries(HARDWARE_GATES_BENCH.map(g=>[g,{status:gateStatus(g,cases,{testLevel}),accepted:false as const}])),
  closures:closuresFor(Array.isArray(identity.checks)?identity.checks:[],verdicts,kit),measurements:[...verdicts.values()].flatMap(v=>v.measurements),
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
   ...fields,deviations:[],artifacts:await fileRefs(out)};
  const v=validateBenchRecord(record);
  if(!v.ok)throw refused('RECORD_SCHEMA_INVALID',v.problems.map(x=>`${x.code} ${x.path}`).join('; '));
  await writeDurable(out,'bench-record.json',json(record));await writeManifest(out);
  return record;
 }catch(e){await rm(out,{recursive:true,force:true});throw e;}
}

const FIELD_CODES:[keyof Derived,string][]=[['kit','KIT_DIGEST_MISMATCH'],['policyDigest','POLICY_DIGEST_MISMATCH'],['parts','PART_MANIFEST_MISMATCH'],['devices','SERIAL_SET_MISMATCH'],
 ['gates','GATE_TABLE_MISMATCH'],['measurements','GATE_TABLE_MISMATCH'],['closures','GATE_TABLE_MISMATCH'],['externalGates','EXTERNAL_GATES_MISMATCH'],
 ['host','RECORD_SCHEMA_INVALID'],['worker','RECORD_SCHEMA_INVALID'],['conditions','RECORD_SCHEMA_INVALID']];
/** Readback: the manifest against the files, the record against its schema, then every recomputable field against `derive`. Nothing is trusted because it is stored. */
export async function verifyBenchRecord(dir:string):Promise<{ok:boolean;issues:Issue[]}>{
 const m=await readJson<{files?:unknown}>(join(dir,'manifest.json'));
 if(!m||!Array.isArray(m.files))return {ok:false,issues:[{code:'FILE_MISSING',path:'manifest.json'}]};
 const files=m.files as FileRef[],issues=await checkManifest(dir,files),v=validateBenchRecord(await readJson(join(dir,'bench-record.json')));
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
