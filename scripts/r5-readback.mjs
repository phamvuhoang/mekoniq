// R5 directory-level artifact reader. Nothing is taken from a status in qualification.json: every input is copied beside the record, hashed and re-verified by the verifier that wrote it
// (the stop campaign verifier, the R4 reader, the package reader) or recomputed here (the three electrical bundles compile again on the host). A missing input makes the cases that name it
// `not_run`; corruption, another tuple or `accepted:true` makes them `failed`.
import {readdirSync,readFileSync,writeFileSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {checkR5Structure,CASES_R5,GATES_R5} from './sim-extension-r5.mjs';
import {boundedEvidenceRead,evidenceInventory} from './r2b-readback.mjs';
import {verifyR4Directory} from './r4-readback.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),root0=resolve(dirname(fileURLToPath(import.meta.url)),'..'),ENGINE=join(root0,'packages/lab-runtime/src/');
const absent=x=>/^[A-Z0-9_]+_MISSING(:|$)/.test(x)||x==='ARTIFACT_READBACK_PENDING'||/_INCOMPLETE$/.test(x);
const OPTIONS=['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1'],EXPECTED_STATES=['blocked','compiled','compiled'];
/** The project CLD04/CLD05 compile against (tests/integration/r5-container.test.ts): the Serve tray fixture with these two fields; the reader rebuilds it, so a record cannot name another. */
export const CLD_PROJECT=Object.freeze({fixture:'robotics/simulation-mujoco/fixtures/serve-tray-v1',overrides:{requestedProfile:'engineering-mujoco-3d-v1',mujocoExperimentId:'tray-stop-coast-v1'}});
export const CLD_STOP_ENTRY=Object.freeze({id:'s1',function:'emergency',trigger:{kind:'elapsed_sim_ms',value:8220}});
const hostCompile=(id,dir)=>{spawnSync(process.execPath,[join(root0,'scripts/lab-hardware.mjs'),'compile','--design',join(root0,`robotics/catalog/electrical/${id}.json`),'--out',join(dir,id)],{stdio:'ignore',timeout:180000});return JSON.parse(readFileSync(join(dir,id,'electrical-bundle.json'),'utf8'));};
/** The three options compiled on this host against the CLD project: {projectDigest, options:{id:{state,digest}}}. */
export async function hostCldBundles(){
 const {compileDesignFile}=await tsImport(ENGINE+'engineering/electrical/offline.ts',import.meta.url),{hashJson}=await tsImport(ENGINE+'v2/hash.ts',import.meta.url);
 const project={...JSON.parse(readFileSync(join(root0,CLD_PROJECT.fixture,'serve-3d-project.json'),'utf8')),...CLD_PROJECT.overrides},dir=mkdtempSync(join(tmpdir(),'r5-cld-'));
 try{writeFileSync(join(dir,'serve-3d-project.json'),JSON.stringify(project));copyFileSync(join(root0,CLD_PROJECT.fixture,'serve-3d-components.json'),join(dir,'serve-3d-components.json'));const options={};
  for(const id of OPTIONS){const b=(await compileDesignFile({design:join(root0,`robotics/catalog/electrical/${id}.json`),catalogRoot:join(root0,'robotics/catalog'),root:root0,projectDir:dir})).bundle;options[id]={state:b?.state,digest:b?.digest};}
  return {projectDigest:hashJson(project),options};}
 finally{rmSync(dir,{recursive:true,force:true});}
}
export async function verifyStopInput(root,m,source){
 const x=m.inputs?.stopCampaign,path='inputs/stop/campaign.json';let b=null;try{b=boundedEvidenceRead(root,path);}catch{/* below */}
 if(!x||x.file!==path||!b)return ['STOP_CAMPAIGN_MISSING'];
 if(sha(b)!==x.sha256)return ['STOP_CAMPAIGN_CORRUPT'];
 let d;try{d=JSON.parse(b);}catch{return ['STOP_CAMPAIGN_CORRUPT'];}
 const r=[];
 if(d.accepted!==false)r.push('STOP_CAMPAIGN_ACCEPTED');if(d.campaign?.id!=='stop-v1')r.push('STOP_CAMPAIGN_ID_MISMATCH');if(d.sourceCommit!==source)r.push('STOP_CAMPAIGN_TUPLE_MISMATCH');
 try{const mod=await tsImport(ENGINE+'v2/control/stop-campaign.ts',import.meta.url),v=await mod.verifyStopCampaign(join(root,'inputs/stop'));
  if(v.completedCases!==v.expectedRuns||v.expectedRuns!==16||v.issues.length||v.missingArtifacts.length)r.push(...v.issues.map(i=>'STOP_CAMPAIGN:'+i),'STOP_CAMPAIGN_INCOMPLETE');
 }catch(e){r.push('STOP_CAMPAIGN_READER:'+e.message);}
 return r;
}
/** One container evidence file (CLD04 on arm64, CLD05 on native amd64) against the host's bundles and the stop schedule; `code` prefixes every issue. */
export async function checkCldEvidence(ev,{code,platform,source,schemaHash,imageId,host}){
 const issues=[],{stopStartTick}=await tsImport(ENGINE+'v2/control/stop-functions.ts',import.meta.url),scheduled=stopStartTick(CLD_STOP_ENTRY);
 if(ev?.schemaVersion!==2||ev.sourceCommit!==source)issues.push(code+'_TUPLE_MISMATCH');
 if(ev?.schemaHash!==schemaHash)issues.push(code+'_SCHEMA_MISMATCH');
 if(ev?.platform!==platform||!/^sha256:[0-9a-f]{64}$/.test(ev?.imageId??'')||imageId&&ev.imageId!==imageId)issues.push(code+'_IDENTITY');
 if(ev?.diffEmpty!==true||!Array.isArray(ev.diff)||!/^[1-9][0-9]*$/.test(String(ev.uid)))issues.push(code+'_ISOLATION');
 if(JSON.stringify(ev?.project)!==JSON.stringify({...CLD_PROJECT,digest:host.projectDigest}))issues.push(code+'_PROJECT_MISMATCH');
 if(JSON.stringify(OPTIONS.map(o=>ev?.options?.[o]?.state))!==JSON.stringify(EXPECTED_STATES))issues.push(code+'_OPTION_STATES');
 for(const id of OPTIONS)if(ev?.options?.[id]?.digest!==host.options[id]?.digest||ev.options[id].state!==host.options[id]?.state||ev.options[id].projectDigest!==host.projectDigest)issues.push(code+'_DIGEST_MISMATCH:'+id);
 const st=ev?.stop;
 if(JSON.stringify(st?.entry)!==JSON.stringify(CLD_STOP_ENTRY)||st.function!=='emergency'||st.scheduledTick!==scheduled||st.tick!==scheduled||st.status!=='needs_attention'||st.served!=='0'||
  !st.attention?.some(a=>a.reason==='EMERGENCY_STOP'&&a.tick===scheduled))issues.push(code+'_STOP');
 return issues;
}
const field=(text,k)=>{const m=text.split('\n').filter(s=>s.startsWith(k+'='));return m.length===1?m[0].slice(k.length+1):null;};
const RUN_URL=/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+\/attempts\/[0-9]+$/;
const NATIVE_STEPS=['install','export','build','guest','pytest','container','receipt'];
/** The complete output of scripts/r5-cld05.sh (.github/workflows/r5-cld05.yml) on a native x86-64 runner: checksums against an independent inventory, the tuple, the workflow run,
 * the image, every step's exit, the pytest receipt (scripts/check-r5-cld05.py) and the container test's own result. Throws CLD05_<code>. */
export function readR5Native(dir,expectedSource,pin){
 const check=(ok,c)=>{if(!ok)throw Error('CLD05_'+c);},read=p=>boundedEvidenceRead(dir,p),sums=read('SHA256SUMS'),listed=new Map();
 for(const line of sums.toString().trimEnd().split('\n')){const m=/^([a-f0-9]{64}) {2}\.\/(.+)$/.exec(line);check(m&&!listed.has(m[2]),'CHECKSUM_TABLE');listed.set(m[2],m[1]);}
 const inventory=evidenceInventory(dirname(dir),basename(dir)).map(f=>({...f,file:f.file.slice(basename(dir).length+1)})).filter(f=>f.file!=='SHA256SUMS');
 const required=['run.txt','host.txt','image.json','runtime-manifest.json','qualification-exit.txt','pytest/full.xml','pytest/collection.json','container/cld05.json','container/test.json',...NATIVE_STEPS.flatMap(k=>[k+'.log',k+'-exit.txt'])];
 check(inventory.length===listed.size&&inventory.every(f=>listed.get(f.file)===f.sha256)&&required.every(f=>listed.has(f))&&!listed.has('refusal.txt'),'CHECKSUM_INVENTORY');
 const host=read('host.txt').toString(),run=read('run.txt').toString(),source=field(host,'source'),head=field(host,'head'),url=field(host,'run');
 check(source===expectedSource&&/^[a-f0-9]{40}$/.test(source)&&head===source,'SOURCE');
 check(/^Linux [^\n]+\bx86_64\b[^\n]*$/m.test(host)&&field(host,'runner_arch')==='X64'&&field(host,'daemon')==='linux/amd64'&&/^unix:\/\/\/[^\s]+$/.test(field(host,'docker_endpoint')??''),'HOST');
 check(RUN_URL.test(url??'')&&field(run,'sha')===head&&field(run,'arch')==='X64'&&field(run,'url')===url,'RUN_IDENTITY');
 const image=JSON.parse(read('image.json')),runtime=JSON.parse(read('runtime-manifest.json'));
 check(image.revision===source&&image.Os==='linux'&&image.Architecture==='amd64'&&/^sha256:[a-f0-9]{64}$/.test(image.Id),'IMAGE');
 check(runtime.sourceCommit===source&&runtime.dirty===false&&/^[a-f0-9]{64}$/.test(runtime.schemaHash)&&(!pin||runtime.artifactSha256===pin.artifactSha256&&runtime.schemaHash===pin.schemaHash),'RUNTIME');
 const lock=runtime.portableSimulationTools?.tools?.find(t=>t.id==='mujoco_worker')?.lock,guest=read('guest.log').toString();
 check(/^Linux-[^\n]*\bx86_64\b[^\n]* 3\.11\./m.test(guest)&&!!lock&&guest.split('\n').includes('mujoco requirements.lock sha256 '+lock.sha256),'GUEST_IDENTITY');
 check(['qualification',...NATIVE_STEPS].every(k=>/^0\n?$/.test(read(k+'-exit.txt').toString())),'PROCESS_EXIT');
 const input=JSON.stringify({xml:read('pytest/full.xml').toString(),collection:JSON.parse(read('pytest/collection.json')),sourceCommit:source,imageId:image.Id});
 const receipt=spawnSync('python3',['-B',join(root0,'scripts/check-r5-cld05.py'),'receipt','-'],{input,timeout:30000,encoding:'utf8'});
 check(receipt.status===0,'PYTEST_RECEIPT');const pytest=JSON.parse(receipt.stdout);
 const vt=JSON.parse(read('container/test.json')),cases=vt.testResults?.flatMap(r=>r.assertionResults??[])??[];
 check(vt.success===true&&vt.numFailedTests===0&&vt.numPendingTests===0&&vt.numPassedTests===1&&cases.length===1&&cases[0].status==='passed'&&
  vt.testResults.length===1&&vt.testResults[0].name.endsWith('/tests/integration/r5-container.test.ts'),'CONTAINER_TEST');
 const evidence=JSON.parse(read('container/cld05.json'));
 return {status:'tested',platform:'linux/amd64',sourceCommit:source,imageId:image.Id,workflowRun:url,tests:{pytest,container:{passed:1}},evidence,result:{file:'cld05/SHA256SUMS',sha256:sha(sums)}};
}
/** CLD04 and CLD05 from the container record copied beside the R5 record; each case gets its own issues (a missing native run never hides a CLD04 result). */
export async function verifyContainerInput(root,m,source){
 const x=m.inputs?.containerRecord,path='inputs/container/container.json',b0=(()=>{try{return boundedEvidenceRead(root,path);}catch{return null;}})();
 const both=i=>({CLD04:i,CLD05:i});
 if(!x||x.file!==path||!b0)return both(['CONTAINER_RECORD_MISSING']);
 if(sha(b0)!==x.sha256)return both(['CONTAINER_RECORD_CORRUPT']);
 let d;try{d=JSON.parse(b0);}catch{return both(['CONTAINER_RECORD_CORRUPT']);}
 if(d.schemaVersion!==2||d.accepted!==false||d.sourceCommit!==source)return both(['CONTAINER_TUPLE_MISMATCH']);
 let host;try{host=await hostCldBundles();}catch(err){return both(['CLD_HOST_COMPILE:'+err.message]);}
 const schemaHash=m.lab?.pin?.schemaHash,out={CLD04:[],CLD05:[]};
 const e=d.cld04;
 if(!e||e.status==='not_run')out.CLD04=['CONTAINER_RECORD_MISSING:'+(e?.reason??'cld04 not recorded')];
 else if(e.status!=='tested')out.CLD04=['CLD04_FAILED:'+(e.reason??'')];
 else{let rb=null;try{rb=boundedEvidenceRead(root,'inputs/container/'+e.evidence?.file);}catch{/* below */}
  if(e.evidence?.file!=='cld04.json'||!rb||sha(rb)!==e.evidence?.sha256)out.CLD04=['CLD04_RESULT_CORRUPT'];
  else{let ev;try{ev=JSON.parse(rb);}catch{ev=null;}out.CLD04=ev?await checkCldEvidence(ev,{code:'CLD04',platform:'linux/arm64',source,schemaHash,imageId:e.imageId,host}):['CLD04_RESULT_CORRUPT'];if(e.sourceCommit!==source)out.CLD04.push('CLD04_TUPLE_MISMATCH');}}
 const n=d.cld05;
 // a native run that has not happened is not_run (with its reason); a requested amd64 build that failed is a failure
 if(!n||n.status==='not_run')out.CLD05=['CLD05_NATIVE_MISSING:'+(n?.reason??'cld05 not recorded')];
 else if(n.status!=='tested')out.CLD05=['CLD05_FAILED:'+(n.reason??'')];
 else if(n.result?.file!=='cld05/SHA256SUMS')out.CLD05=['CLD05_NATIVE_DIRECTORY_REQUIRED'];
 else try{const native=readR5Native(join(root,'inputs/container/cld05'),source,m.lab?.pin);
  if(native.result.sha256!==n.result.sha256||['imageId','sourceCommit','platform','workflowRun'].some(k=>native[k]!==n[k])||JSON.stringify(native.tests)!==JSON.stringify(n.tests))out.CLD05.push('CLD05_TUPLE_MISMATCH');
  out.CLD05.push(...await checkCldEvidence(native.evidence,{code:'CLD05',platform:'linux/amd64',source,schemaHash,imageId:native.imageId,host}));
 }catch(err){out.CLD05=['CLD05_NATIVE_INVALID:'+err.message];}
 return out;
}
export async function verifyPackageInput(root,m){
 const x=m.inputs?.hardwarePackage,base='inputs/package';let b=null;try{b=boundedEvidenceRead(root,base+'/manifest.json');}catch{/* below */}
 if(!x||x.file!==base+'/manifest.json'||!b)return ['HARDWARE_PACKAGE_MISSING'];
 if(sha(b)!==x.sha256)return ['HARDWARE_PACKAGE_CORRUPT'];
 const walk=(rel)=>readdirSync(join(root,base,rel),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(rel?rel+'/'+e.name:e.name):[rel?rel+'/'+e.name:e.name]);
 const issues=[];
 try{const {verifyHardwareCandidate}=await tsImport(ENGINE+'engineering/electrical/package.ts',import.meta.url);
  const read=async p=>{try{return new Uint8Array(boundedEvidenceRead(root,base+'/'+p));}catch{return null;}};
  issues.push(...(await verifyHardwareCandidate(read,async()=>walk(''))).map(p=>'PACKAGE:'+p));
  const man=JSON.parse(b),dir=mkdtempSync(join(tmpdir(),'r5-read-'));
  try{const host=hostCompile('serve-hw-c-v1',dir);if(man.bundle?.designId!=='serve-hw-c-v1'||man.status!=='draft'||man.hardwareValidated!==false||man.controlAuthority!==false)issues.push('PACKAGE_IDENTITY');
   const inside=JSON.parse(boundedEvidenceRead(root,base+'/electrical-bundle.json'));if(inside.digest!==host.digest||man.bundle?.digest!==host.digest)issues.push('PACKAGE_DIGEST_MISMATCH');}
  finally{rmSync(dir,{recursive:true,force:true});}
 }catch(e){issues.push('PACKAGE_READER:'+e.message);}
 return issues;
}
export async function verifyR4Input(root,m,source,lab){
 const x=m.inputs?.r4Record,path='inputs/r4/qualification.json';let b=null;try{b=boundedEvidenceRead(root,path);}catch{/* below */}
 if(!x||x.file!==path||!b)return ['R4_RECORD_MISSING'];
 if(sha(b)!==x.sha256)return ['R4_RECORD_CORRUPT'];
 let q;try{q=JSON.parse(b);}catch{return ['R4_RECORD_CORRUPT'];}
 const r=[];
 if(q.release!=='r4'||q.accepted!==false||q.identity?.before?.sourceCommit!==source||q.lab?.commit!==lab||JSON.stringify(q.lab?.pin)!==JSON.stringify(m.lab?.pin))r.push('R4_TUPLE_MISMATCH');
 // CLD02 needs a native Linux x86-64 host and CLD03 a deploy order: the two cases R4 may leave not_run here; everything else must be tested
 for(const [id,c] of Object.entries(q.cases??{}))if(c.status!=='tested'&&!['CLD02','CLD03'].includes(id))r.push('R4_CASE_NOT_TESTED:'+id);
 const mock=m.inputs?.mockRegression,theirs=q.inputs?.mockRegression;if(!mock||!theirs||mock.sha256!==theirs.sha256)r.push('R4_MOCK_REGRESSION_MISMATCH');
 try{r.push(...(await verifyR4Directory(join(root,'inputs/r4'))).filter(i=>!absent(i)).map(i=>'R4:'+i));}catch(e){r.push('R4_READER:'+e.message);}
 return r;
}
export async function collectR5ArtifactDispositions(root,m){
 const source=m.identity?.before?.sourceCommit,lab=m.lab?.commit,groups={};
 groups.stopCampaign=await verifyStopInput(root,m,source);
 groups.containerRecord=await verifyContainerInput(root,m,source);
 groups.hardwarePackage=await verifyPackageInput(root,m);
 groups.r4Record=await verifyR4Input(root,m,source,lab);
 const issues=Object.values(groups).flatMap(g=>Array.isArray(g)?g:Object.values(g).flat());
 return {issues:[...new Set(issues)],artifactDispositions:artifactDispositionsFromGroups(groups)};
}
export function artifactDispositionsFromGroups(groups){
 const out={};for(const [id,c] of Object.entries(CASES_R5)){
  if(c.notRun){out[id]={status:'not_run',issues:[c.notRun]};continue;}
  const g=c.input?groups[c.input]:[],issues=(Array.isArray(g)?g:g?.[id])??['ARTIFACT_READBACK_PENDING'];
  out[id]={status:issues.length?(issues.every(absent)?'not_run':'failed'):'tested',issues};
 }return out;
}
export async function assessR5Directory(root,m){
 const read=p=>{try{return boundedEvidenceRead(root,p);}catch{return null;}},r=checkR5Structure(m,read);if(m.release!=='r5')r.push('NOT_R5');
 try{if(JSON.stringify(evidenceInventory(root))!==JSON.stringify(m.artifacts))r.push('ARTIFACT_INVENTORY_MISMATCH');}catch(e){r.push(e.message);}
 const d=await collectR5ArtifactDispositions(root,m);r.push(...d.issues.filter(x=>!absent(x)));if(JSON.stringify(m.artifactDispositions)!==JSON.stringify(d.artifactDispositions))r.push('ARTIFACT_DISPOSITION_MISMATCH');
 for(const [id,x] of Object.entries(m.cases??{}))if(x.accepted===true)r.push('CASE_ACCEPTED:'+id);
 for(const g of ['G-BENCH1','G-SAFE1'])if(m.externalGates?.[g]?.status!=='blocked_external'||m.externalGates[g].accepted!==false)r.push('EXTERNAL_GATE:'+g);
 return [...new Set(r)];
}
export async function verifyR5Directory(root){let m;try{m=JSON.parse(boundedEvidenceRead(root,'qualification.json'));}catch(e){return ['R5_RECORD_MISSING:'+e.message];}return assessR5Directory(root,m);}
export {CASES_R5,GATES_R5};
if(import.meta.main){
 const [dir]=process.argv.slice(2),issues=await verifyR5Directory(resolve(dir));
 console.log(JSON.stringify({accepted:false,issues}));process.exitCode=issues.length?1:0;
}
