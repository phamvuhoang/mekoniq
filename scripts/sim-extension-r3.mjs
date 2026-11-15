// R3 scopes are fixed here, never selected by an evidence manifest's pass list.
import {isDeepStrictEqual as same} from 'node:util';
const prep='DEP-PREP-01',sec='DEP-SEC-01';
const profiles={
 'mujoco-linux-amd64':{architecture:'amd64',kind:'mujoco',gate:'G-NATIVE-MJ',scopes:{prepared:[],full:['DEP-MJ-01',sec]}},
 'mujoco-linux-arm64':{architecture:'arm64',kind:'mujoco',gate:'G-NATIVE-MJ',scopes:{prepared:[],full:['DEP-MJ-01',sec]}},
 'engineering-amd64':{architecture:'amd64',kind:'engineering',gate:'G-NATIVE-AMR',scopes:{prepared:[],motion:['DEP-NAV-01','DEP-NAV-02','DEP-NAV-03','DEP-NAV-04',sec],full:['DEP-NAV-01','DEP-NAV-02','DEP-NAV-03','DEP-NAV-04',sec]}},
 'engineering-arm64':{architecture:'arm64',kind:'engineering',gate:'G-NATIVE-AMR',scopes:{prepared:[],motion:['DEP-NAV-01','DEP-NAV-02','DEP-NAV-03','DEP-NAV-04',sec],full:['DEP-NAV-01','DEP-NAV-02','DEP-NAV-03','DEP-NAV-04',sec]}},
 'xarm6-jazzy-sim':{architecture:null,kind:'xarm',gate:'G-NATIVE-ARM',scopes:{prepared:[],motion:['DEP-XARM-01','DEP-XARM-02',sec],contact:['DEP-XARM-01','DEP-XARM-02','DEP-XARM-03',sec],full:['DEP-XARM-01','DEP-XARM-02','DEP-XARM-03',sec]}},
 'puma560-linuxcnc-sim':{architecture:null,kind:'linuxcnc',gate:'G-NATIVE-ARM',scopes:{prepared:[],terminal:['DEP-CNC-01','DEP-CNC-02','ALG04',sec],full:['DEP-CNC-01','DEP-CNC-02','DEP-CNC-03','ALG04',sec]}},
};
export function tableR3(profile,scope){
 const p=Object.hasOwn(profiles,profile)?profiles[profile]:null;if(!p)throw Error('R3_PROFILE_UNSUPPORTED');if(!Object.hasOwn(p.scopes,scope))throw Error('R3_SCOPE_UNSUPPORTED');
 return structuredClone({profile,scope,architecture:p.architecture,kind:p.kind,gate:p.gate,requiredCases:[prep,...p.scopes[scope]],nativeCases:p.scopes.full,cases:[prep,...p.scopes.full,'PHYS-PREP-01']});
}
export function checkR3Structure(m){
 const r=[];if(m?.accepted!==false||m?.acceptedBy!==null||m?.acceptedAt!==null)r.push('RECORD_ACCEPTED');
 if(m?.schemaVersion!==1||m?.documentType!=='sim-extension-qualification'||m?.release!=='r3'||m?.dynamics!=='not_calibrated')r.push('R3_RECORD_SCHEMA');
 try{const t=tableR3(m.profile,m.scope);if(!same(m.requiredCases,t.requiredCases))r.push('R3_REQUIRED_CASES');if(!same(Object.keys(m.cases??{}).sort(),t.cases.slice().sort()))r.push('R3_CASE_TABLE');}catch(e){r.push(e.message);}
 if(!/^[\w.-]{1,160}$/.test(m?.candidateId??''))r.push('R3_CANDIDATE_ID');
 if(!/^[a-f0-9]{40}$/.test(m?.checker?.sourceCommit??'')||!/^[a-f0-9]{64}$/.test(m?.checker?.toolSha256??''))r.push('R3_CHECKER_IDENTITY');
 if(m?.checker?.sourceCommit!==m?.identity?.before?.sourceCommit)r.push('R3_CHECKER_TUPLE');
 if(m?.identity?.identityStable!==true||!same(m?.identity?.before,m?.identity?.after)||m?.identity?.before?.dirty!==false||m?.lab?.dirty!==false)r.push('R3_IDENTITY_UNSTABLE');
 if(m?.campaign!==null||m?.performance!==null)r.push('R3_UNEXPECTED_SUMMARY');
 for(const k of ['requiredCaseOverride','artifactsVerified','nativeReady','acceptedScope','suites'])if(k in (m??{}))r.push('R3_OVERRIDE_UNSUPPORTED:'+k);
 return r;
}
