// R5 directory-level artifact reader. Nothing is taken from a status in qualification.json: every input is copied beside the record, hashed and re-verified by the verifier that wrote it
// (the stop campaign verifier, the R4 reader, the package reader) or recomputed here (the three electrical bundles compile again on the host). A missing input makes the cases that name it
// `not_run`; corruption, another tuple or `accepted:true` makes them `failed`.
import {readdirSync,readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
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

/** The body of a bundle that does not depend on the project it was compiled against: what a host and a container must agree on. */
const bundleBody=async b=>{const {hashJson}=await tsImport(ENGINE+'v2/hash.ts',import.meta.url);return hashJson({allocation:b.allocation,netlist:b.netlist,checks:b.checks,bom:b.bom,driveModelDraft:b.driveModelDraft,state:b.state});};
const hostCompile=(id,dir)=>{spawnSync(process.execPath,[join(root0,'scripts/lab-hardware.mjs'),'compile','--design',join(root0,`robotics/catalog/electrical/${id}.json`),'--out',join(dir,id)],{stdio:'ignore',timeout:180000});return JSON.parse(readFileSync(join(dir,id,'electrical-bundle.json'),'utf8'));};

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
export async function verifyContainerInput(root,m,source){
 const x=m.inputs?.containerRecord,path='inputs/container/container.json',b0=(()=>{try{return boundedEvidenceRead(root,path);}catch{return null;}})();
 if(!x||x.file!==path||!b0)return ['CONTAINER_RECORD_MISSING'];
 if(sha(b0)!==x.sha256)return ['CONTAINER_RECORD_CORRUPT'];
 let d;try{d=JSON.parse(b0);}catch{return ['CONTAINER_RECORD_CORRUPT'];}
 if(d.schemaVersion!==1||d.accepted!==false||d.sourceCommit!==source)return ['CONTAINER_TUPLE_MISMATCH'];
 const e=d.cld04;if(!e||e.status==='not_run')return ['CONTAINER_RECORD_MISSING:'+(e?.reason??'cld04 not recorded')];
 if(e.status!=='tested')return ['CLD04_FAILED'];
 const f=e.evidence?.file;let rb=null;try{rb=boundedEvidenceRead(root,'inputs/container/'+f);}catch{/* below */}
 if(!rb||sha(rb)!==e.evidence?.sha256)return ['CLD04_RESULT_CORRUPT'];
 const issues=[];let ev;try{ev=JSON.parse(rb);}catch{return ['CLD04_RESULT_CORRUPT'];}
 if(ev.sourceCommit!==source||e.sourceCommit!==source)issues.push('CLD04_TUPLE_MISMATCH');
 if(ev.schemaHash!==m.lab?.pin?.schemaHash)issues.push('CLD04_SCHEMA_MISMATCH');
 if(ev.platform!=='linux/arm64'||ev.diffEmpty!==true||!/^sha256:[0-9a-f]{64}$/.test(ev.imageId??''))issues.push('CLD04_IDENTITY');
 if(JSON.stringify(OPTIONS.map(o=>ev.options?.[o]?.state))!==JSON.stringify(EXPECTED_STATES))issues.push('CLD04_OPTION_STATES');
 if(ev.stop?.function!=='emergency'||ev.stop?.status!=='needs_attention'||!(ev.stop?.tick>=411&&ev.stop.tick<=413)||ev.stop?.served!=='0')issues.push('CLD04_STOP');
 // the host compiles the three designs again; the container's bundle bodies must be these
 const dir=mkdtempSync(join(tmpdir(),'r5-read-'));
 try{for(const id of OPTIONS){const host=hostCompile(id,dir);if(host.state!==ev.options?.[id]?.state||await bundleBody(host)!==ev.options?.[id]?.body)issues.push('CLD04_BODY_MISMATCH:'+id);}}
 catch(err){issues.push('CLD04_HOST_COMPILE:'+err.message);}finally{rmSync(dir,{recursive:true,force:true});}
 return issues;
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
   const inside=JSON.parse(boundedEvidenceRead(root,base+'/electrical-bundle.json'));if(await bundleBody(inside)!==await bundleBody(host))issues.push('PACKAGE_BODY_MISMATCH');}
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
 const issues=Object.values(groups).flat();
 return {issues:[...new Set(issues)],artifactDispositions:artifactDispositionsFromGroups(groups)};
}
export function artifactDispositionsFromGroups(groups){
 const out={};for(const [id,c] of Object.entries(CASES_R5)){
  if(c.notRun){out[id]={status:'not_run',issues:[c.notRun]};continue;}
  const issues=c.input?groups[c.input]??['ARTIFACT_READBACK_PENDING']:[];
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
