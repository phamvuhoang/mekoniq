import {isDeepStrictEqual as same} from 'node:util';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {tsImport} from 'tsx/esm/api';
import {tableR3,checkR3Structure} from './sim-extension-r3.mjs';
import {boundedEvidenceRead as bytes,evidenceInventory,verifyR2bDirectory} from './r2b-readback.mjs';
import {readEngineeringObservation,readXarmObservation,readLinuxcncObservation,ENGINEERING_RUNS,XARM_RUNS} from './r3-native-readback.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),read=(r,p)=>JSON.parse(bytes(r,p));
const missing=(reason,category='missing_observation')=>({status:'not_run',reason,category});
const limitations={
 engineering:['TF_PAYLOAD_AND_COMMAND_CORRELATION_NOT_INDEPENDENTLY_VERIFIED','ISOLATION_INSTALL_TRUST_AND_REPLAY_QUALIFICATION_INCOMPLETE'],
 xarm:['CONTROLLER_RESTART_NOT_OBSERVED','COLLISION_PLANNING_NOT_OBSERVED','G2_CONTACT_NOT_OBSERVED'],
 linuxcnc:['CONTROLLER_CLOCK_SYNCHRONY_CARTESIAN_ENDPOINTS_UNAVAILABLE','TERMINAL_ATOMIC_FENCING_GUI_PACKAGE_TRUST_NOT_QUALIFIED'],
 mujoco:[],
};
export async function collectR3Artifacts(root,m){
 root=resolve(root);const detail=value=>String(value?.message??value).split(root).join('<evidence>');
 const t=tableR3(m.profile,m.scope),issues=[],cases=Object.fromEntries(t.cases.map(id=>[id,missing('ASSIGNED_HOST_CASE_ARTIFACTS_MISSING','external')])),observations={};
 cases['PHYS-PREP-01']=missing('DOSSIER_AND_CONFORMANCE_EXECUTION_NOT_RECORDED; structure-only readiness cannot prove commissioning preparation','missing_observation');
 let handoff,assessment,architecture;
 try{
  const api=await tsImport('../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url);handoff=await api.readNativeHandoff(join(root,'inputs/handoff'));architecture=handoff.profile.architecture;
  if(['engineering','xarm'].includes(t.kind)&&(handoff.profile.os.id!=='ubuntu'||handoff.profile.os.version!=='24.04')||t.kind==='linuxcnc'&&(handoff.profile.os.id!=='debian'||handoff.profile.os.version!=='12'))issues.push('R3_PROFILE_OS_BINDING');
  let inventory;try{inventory=read(root,'inputs/handoff/inventory.json');}catch(e){if(e.code!=='ENOENT')throw e;}
  assessment=await api.validateNativeHandoff(join(root,'inputs/handoff'),handoff,inventory);
  if(!assessment.prepared)issues.push(...assessment.issues.filter(i=>i.severity==='error').map(i=>'R3_HANDOFF:'+i.code));
  const kind={mujoco:'mujoco_image',engineering:'ros2_native',xarm:'ros2_native',linuxcnc:'linuxcnc_native'}[t.kind];
  if(handoff.profile.id!==m.profile||t.architecture&&architecture!==t.architecture||!['amd64','arm64'].includes(architecture)||handoff.subject.executionKind!==kind)issues.push('R3_PROFILE_BINDING');
  if(!same(handoff.subject,m.subject))issues.push('R3_SUBJECT_BINDING');
  const s=handoff.subject,b=m.identity?.before,p=m.lab?.pin;
  if(b?.sourceCommit!==s.sourceCommit||b?.toolClosures?.portable!==s.portableClosureHash||s.nativeClosureHash!==null&&b?.toolClosures?.native!==s.nativeClosureHash||m.lab?.commit!==s.labCommit||p?.sourceCommit!==s.sourceCommit||p?.schemaHash!==s.schemaHash||p?.artifactSha256!==s.runtimeArtifactSha256||p?.portableToolsDigest!==s.portableClosureHash)issues.push('R3_COMMON_TUPLE');
  cases['DEP-PREP-01']=issues.length?{status:'failed',reason:issues.join(';'),category:'invalid_artifact'}:{status:'tested',reason:'L00_STATIC_HANDOFF_RECOMPUTED; supplied inventory is not scenario evidence',category:'prepared'};
 }catch(e){issues.push('R3_HANDOFF_UNREADABLE:'+detail(e));cases['DEP-PREP-01']={status:'failed',reason:issues.at(-1),category:'invalid_artifact'};}
 // Known producer limitations stay visible even when no host has been assigned.
 for(const id of t.nativeCases)if(limitations[t.kind].length)cases[id]=missing('ASSIGNED_HOST_CASE_ARTIFACTS_MISSING; '+limitations[t.kind].join(';'),'tooling_and_observation');
 let index;try{index=read(root,'inputs/native/index.json');}catch(e){if(e.code!=='ENOENT')issues.push('R3_NATIVE_INDEX_UNREADABLE:'+detail(e));}
 if(index){
  const roles={mujoco:['historical','current','r2bQualification'],engineering:['engineering'],xarm:['xarm'],linuxcnc:['linuxcnc']}[t.kind];
  if(index.schemaVersion!==1||index.profile!==m.profile||index.architecture!==architecture||!same(index.subject,handoff?.subject)||!index.records||typeof index.records!=='object'||Array.isArray(index.records)||Object.keys(index.records).some(k=>!roles.includes(k)))issues.push('R3_NATIVE_INDEX_BINDING');
  else for(const [role,entry]of Object.entries(index.records))try{
   if(!entry||!same(Object.keys(entry).sort(),['directory'])||typeof entry.directory!=='string'||!/^[\w-]+$/.test(entry.directory))throw Error('R3_NATIVE_RECORD_PATH');
   const dir=join(root,'inputs/native',entry.directory);evidenceInventory(dir);
   if(role==='historical'||role==='current'){
    const raw=read(dir,'manifest.json');if(role==='current'&&!same(raw.subject,handoff.subject))throw Error('R3_CURRENT_SUBJECT_BINDING');
    // Public native readers audit their exact clean checker graph; never substitute a caller checker.
    const {invokeCheckedProbe}=await import('./native-sim/probe-bootstrap.mjs');const v=await invokeCheckedProbe(role==='historical'?'verify':'verify-r2b',{root:dir});
    observations[role]={subject:raw.subject,checker:raw.checker,passed:v.passed,issues:v.issues.map(detail)};if(!v.passed)issues.push(...v.issues.map(i=>'R3_NATIVE:'+role+':'+detail(i)));
   }else if(role==='r2bQualification'){
    const q=read(dir,'qualification.json');if(q.release!=='r2b'||q.identity?.before?.sourceCommit!==handoff.subject.sourceCommit||q.lab?.commit!==handoff.subject.labCommit||q.lab?.pin?.schemaHash!==handoff.subject.schemaHash||q.lab?.pin?.artifactSha256!==handoff.subject.runtimeArtifactSha256)throw Error('R3_R2B_TUPLE');
    const problems=await verifyR2bDirectory(dir);observations[role]={passed:!problems.length,issues:problems};issues.push(...problems.map(i=>'R3_R2B:'+i));
   }else{
    if(role==='linuxcnc')observations[role]=await readLinuxcncObservation(dir,handoff.subject);
    else{
     observations[role]=[];
     for(const spec of role==='engineering'?ENGINEERING_RUNS:XARM_RUNS){
      try{const path=join(dir,spec.directory),result=role==='engineering'?await readEngineeringObservation(path,handoff.subject,m.profile):await readXarmObservation(path,handoff.subject,handoff.profile);
       if(result.nativeCase!==spec.nativeCase||role==='engineering'&&result.seed!==spec.seed||role==='xarm'&&result.mode!==spec.mode)throw Error('R3_RUN_CASE_BINDING');observations[role].push({...spec,...result});
      }catch(e){const absent=e.code==='ENOENT';observations[role].push({...spec,status:absent?'not_run':'failed',reason:detail(e)});if(!absent)issues.push('R3_NATIVE:'+role+':'+spec.directory+':'+detail(e));}
     }
    }
   }
  }catch(e){issues.push('R3_NATIVE:'+role+':'+detail(e));observations[role]={qualification:'failed',issues:[detail(e)]};}
 }
 if(t.kind==='mujoco'&&observations.historical?.passed&&observations.current?.passed&&assessment?.nativeReady&&architecture==='amd64')cases['DEP-MJ-01']={status:'tested',reason:'Historical R2a and current R2b public native artifact readers passed independently',category:'native'};
 const affected={historical:['DEP-MJ-01'],current:['DEP-MJ-01'],engineering:['DEP-NAV-01','DEP-NAV-02','DEP-NAV-03','DEP-NAV-04'],xarm:['DEP-XARM-01','DEP-XARM-02'],linuxcnc:['DEP-CNC-01','ALG04']};
 for(const [role,ids]of Object.entries(affected)){const failures=issues.filter(i=>i.startsWith('R3_NATIVE:'+role+':'));if(failures.length)for(const id of ids)if(id in cases)cases[id]={status:'failed',reason:failures.join(';'),category:'invalid_artifact'};}
 // DEP-SEC-01 remains a required case: Docker containment is not the complete native security matrix.
 cases['DEP-SEC-01']=missing('ASSIGNED_HOST_SECURITY_ARTIFACTS_MISSING; COMPLETE_PROFILE_SECURITY_OBSERVATION_READER_NOT_IMPLEMENTED','tooling_and_observation');
 const requiredCases=t.requiredCases,blockedNativeCases=t.nativeCases.filter(id=>cases[id].status!=='tested').map(id=>({id,...cases[id]}));
 const gateCases=m.scope==='prepared'?t.nativeCases:requiredCases.filter(id=>id!=='DEP-PREP-01');
 const nativeStatus=gateCases.every(id=>cases[id].status==='tested')?'tested':issues.some(i=>i.startsWith('R3_NATIVE:'))?'failed':blockedNativeCases.every(c=>c.category==='external')?'blocked_external':'not_run';
 const gates={'G-PREP':{status:cases['DEP-PREP-01'].status,accepted:false,cases:['DEP-PREP-01']},[t.gate]:{status:nativeStatus,accepted:false,cases:gateCases,blockers:blockedNativeCases.map(c=>({id:c.id,category:c.category,reason:c.reason}))},'G-PHYS-PREP':{status:'not_run',accepted:false,cases:['PHYS-PREP-01']}};
 return {requiredCases,cases,gates,blockedNativeCases,capabilities:{architecture:architecture??null,scope:m.scope,observations,preparation:assessment??null,toolingLimitations:[...limitations[t.kind],...t.kind==='mujoco'&&architecture==='arm64'?['MUJOCO_ARM64_CAMPAIGN_ADAPTER_NOT_IMPLEMENTED']:[],'COMPLETE_PROFILE_SECURITY_OBSERVATION_READER_NOT_IMPLEMENTED'],hardware:'not_run',calibration:'not_calibrated'},levels:{'R3.0':cases['DEP-PREP-01'].status,'R3.1':m.scope!=='prepared'&&nativeStatus==='tested'?'tested':'not_run','R3.2':'not_run'},issues};
}
export async function assessR3Directory(root,m){
 const issues=checkR3Structure(m);try{
  if(!same(evidenceInventory(root),m.artifacts))issues.push('R3_ARTIFACT_INVENTORY');
  const derived=await collectR3Artifacts(root,m);issues.push(...derived.issues);
  for(const key of ['requiredCases','cases','gates','blockedNativeCases','capabilities','levels','issues'])if(!same(m[key],derived[key]))issues.push('R3_DERIVED_MISMATCH:'+key);
  if(derived.requiredCases.some(id=>derived.cases[id].status!=='tested'))issues.push('R3_SCOPE_INCOMPLETE');
  if(!same(evidenceInventory(root),m.artifacts))issues.push('R3_ARTIFACT_CHANGED_DURING_READBACK');
 }catch(e){issues.push('R3_READBACK:'+e.message);}return [...new Set(issues)];
}
export async function verifyR3Directory(root){try{return await assessR3Directory(root,read(root,'qualification.json'));}catch(e){return ['R3_RECORD_UNREADABLE:'+e.message];}}
export async function verifyR3Sidecar(root,sidecar){
 const issues=await verifyR3Directory(root);try{const b=bytes(root,'qualification.json'),m=JSON.parse(b);
  if(sidecar?.schemaVersion!==1||sidecar.documentType!=='r3-human-review'||sidecar.candidateSha256!==sha(b)||sidecar.candidateId!==m.candidateId||sidecar.profile!==m.profile||sidecar.architecture!==m.capabilities.architecture||sidecar.scope!==m.scope||!['accept','reject'].includes(sidecar.decision)||typeof sidecar.reviewer!=='string'||!sidecar.reviewer.trim()||typeof sidecar.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(sidecar.reviewedAt)||!Number.isFinite(Date.parse(sidecar.reviewedAt)))issues.push('R3_SIDECAR_BINDING');
 }catch{issues.push('R3_SIDECAR_BINDING');}return [...new Set(issues)];
}
