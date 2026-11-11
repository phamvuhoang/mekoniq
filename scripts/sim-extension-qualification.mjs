// sim-extension-qualification/1 (W09 Release 1; X08 Release 1.1 adds the `r1.1` table below): the one mapping from the verification cases of spec 2026-11-10-simulation-extension-design.md §6.3 to the evidence that
// tests them, shared by scripts/record-sim-extension.mjs (which writes qualification.json) and tests/acceptance/sim-extension.acceptance.test.ts (which refuses it).
// It uses the same core as the LinkForge + IR-SIM record (scripts/irsim-qualification.mjs) with its own table. `tested` means the named campaign cases passed, the named suites
// ran green and the named recorded inputs agree on the recorded candidate; it is never `accepted` (a human reviewer sets that), and a skipped test is never a pass.
import {createHash} from 'node:crypto';
import {checkQualification as check,qualify as qualifyWith} from './irsim-qualification.mjs';
const sha=(b)=>createHash('sha256').update(b).digest('hex');
const V=(files)=>({repo:'source',kind:'vitest',files});
/** The suites record-sim-extension runs. Same shape as irsim-qualification's: `files` goes to vitest/pytest, `python` is the pinned interpreter, `command` is a Lab script. */
export const SUITES=[
 {id:'alg-ts',...V(['tests/integration/algorithm-kinematics.test.ts','tests/integration/algorithm-pid.test.ts','tests/security/algorithm-checker.test.ts','tests/unit/pid.test.ts','tests/unit/lab-algorithm-cli.test.ts'])},
 {id:'alg-py',repo:'source',kind:'pytest',python:'.venv-algorithm/bin/python',pythonPath:['robotics/algorithm'],files:['robotics/algorithm/tests']},
 {id:'wb-static',...V(['tests/unit/sim3d-fixtures.test.ts','tests/unit/sim3d-lidar-oracle.test.ts','tests/contracts/sim-extension-contracts.test.ts'])},
 {id:'wb-py',repo:'source',kind:'pytest',python:'.venv-webots/bin/python',pythonPath:['robotics/simulation-3d'],files:['robotics/simulation-3d/tests']},
 {id:'wb-worker',...V(['tests/integration/webots-worker.test.ts','tests/integration/webots-readiness.test.ts'])},
 {id:'wb-mission',...V(['tests/integration/webots-mission.test.ts'])},
 {id:'wb-fleet',...V(['tests/integration/webots-fleet.test.ts'])},
 {id:'wb-faults',...V(['tests/integration/webots-faults.test.ts','tests/security/webots-authority.test.ts'])},
 {id:'wb-evidence',...V(['tests/integration/webots-evidence.test.ts'])},
 {id:'wb-batch',...V(['tests/integration/webots-batch.test.ts'])},
 // INT12 and REG01: the IR-SIM plant, its golden chunk hashes, the exported closure and the CLI are unchanged
 {id:'int-regress',...V(['tests/integration/irsim-plant-port.test.ts','tests/integration/portable-tool-closure.test.ts','tests/integration/lab-runtime-artifact.test.ts','tests/unit/irsim-cli.test.ts','tests/unit/sim-extension-qualification.test.ts'])},
 {id:'lab-unit',repo:'lab',kind:'vitest',files:['tests/unit/backend-options.test.ts','tests/unit/pose3d.test.ts','tests/unit/navigation2d-report.test.ts','tests/unit/twin-workspace.test.ts','tests/integration/webots-launcher.test.ts','tests/integration/runtime-artifact.test.ts']},
 // one spec per launcher: the launcher's pairing code is one-use, so a second spec behind the same launcher can never pair
 {id:'lab-e2e-webots-journey',repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--provider','webots','webots-journey.spec.ts']},
 {id:'lab-e2e-webots-fleet',repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--provider','webots','webots-fleet.spec.ts']},
];
const ALG={suites:['alg-ts','alg-py']},WB=(campaign,suites,extra={})=>({campaign,suites,...extra});
export const CASES={
 ALG01:{...ALG,algorithm:['ALG01']},ALG02:{...ALG,algorithm:['ALG02']},ALG03:{...ALG,algorithm:['ALG03']},ALG05:{...ALG,algorithm:['ALG05']},
 // R3: the joint trace needs a running LinuxCNC bridge; R1 writes no generator to have something to check
 ALG04:{notRun:'R3: the joint trace needs a running LinuxCNC bridge'},
 PID01:{...ALG,algorithm:['PID01']},PID02:{...ALG,algorithm:['PID02']},PID03:{...ALG,algorithm:['PID03']},
 WB01:{suites:['wb-static','wb-py','wb-worker']},WB02:{suites:['wb-static','wb-py','wb-worker']},WB08:{suites:['wb-py','wb-worker']},
 WB03:WB(['WB-FD01'],['wb-mission']),
 WB04:WB(['WB-FD07'],['wb-fleet'],{note:'source-driven WB-FD07 missions are serialized by the __venue_movement__ reservation (both robots move, one at a time); there is no zone-contention rig for Webots in Release 1, so zone contention is not proven here'}),
 WB05:WB(['WB-FD01-cancel','WB-FD01-enginekill'],['wb-faults']),
 WB06:WB(['WB-FD01','WB-FD07'],['wb-evidence','wb-batch']),WB07:WB(['WB-FD01','WB-FD07'],['wb-evidence']),
 INT11:{lab:true,suites:['lab-e2e-webots-journey','lab-e2e-webots-fleet']},
 INT12:{suites:['wb-worker','int-regress','lab-unit']},
 REG01:{suites:['int-regress'],irsimRecord:true,mockRegression:true},
};
export const GATES={'G-ALG1':['ALG01','ALG02','ALG03','ALG05'],'G-ALG2':['PID01','PID02','PID03'],'G-WB1':['WB01','WB02','WB08'],'G-WB2':['WB03','WB04','WB05','WB06','WB07'],'G-INT2':['INT11','INT12'],'G-REG1':['REG01']};
export const GATE_IDS=Object.keys(GATES);
const HEX=/^[0-9a-f]{64}$/;

/** The IR-SIM record this R1 record builds on: it must be the LinkForge + IR-SIM record of the SAME source commit, complete, with no accepted gate and all six gates tested. */
export function checkIrsimRecord(doc,sourceCommit){
 const r=[];
 if(!doc||doc.documentType!=='linkforge-irsim-qualification')return ['IRSIM_RECORD_NOT_LINKFORGE'];
 if(doc.accepted!==false)r.push('IRSIM_RECORD_ACCEPTED');
 if(doc.identity?.before?.sourceCommit!==sourceCommit)r.push(`IRSIM_RECORD_COMMIT: ${doc.identity?.before?.sourceCommit??'none'}, this source ${sourceCommit}`);
 const gates=Object.entries(doc.gates??{});if(gates.length!==6)r.push('IRSIM_RECORD_GATES');
 for(const [g,x] of gates)if(x.status!=='tested')r.push(`IRSIM_GATE_NOT_TESTED:${g}`);
 return r;
}

/** The recorded inputs of the R1 table read back from the files beside qualification.json: nothing is taken from a claim in the manifest itself. */
function inputs(m,read){
 const reasons=[],input={},parsed=(file,sha256,missing,corrupt)=>{
  if(!file||!HEX.test(sha256??'')){reasons.push(missing);return null;}
  const b=read(file);if(!b){reasons.push(missing);return null;}
  if(sha(b)!==sha256){reasons.push(corrupt);return null;}
  try{return JSON.parse(b.toString('utf8'));}catch{reasons.push(corrupt);return null;}};
 const alg=parsed(m.algorithm?.file,m.algorithm?.sha256,'ALGORITHM_RESULTS_MISSING','ALGORITHM_RESULTS_CORRUPT');
 if(alg){input.algorithm=alg;if(alg.oracleProfileDigest!==m.identity?.before?.oracleProfileDigest)reasons.push('ORACLE_PROFILE_MISMATCH');}
 const irs=parsed(m.irsimRecord?.file,m.irsimRecord?.sha256,'IRSIM_RECORD_MISSING','IRSIM_RECORD_CORRUPT');
 if(irs){input.irsim=irs;reasons.push(...checkIrsimRecord(irs,m.identity?.before?.sourceCommit));}
 const mock=parsed(m.mockRegression?.file,m.mockRegression?.sha256,'MOCK_REGRESSION_MISSING','MOCK_REGRESSION_CORRUPT');
 if(mock){input.mock=mock;if(mock.schema!=='lab-v2-regression/1')reasons.push('MOCK_REGRESSION_NOT_LAB_MANIFEST');}
 return {input,reasons};
}
export const TABLE={documentType:'sim-extension-qualification',cases:CASES,gates:GATES,suites:SUITES,providerKind:'webots_engine',providerReason:'PROVIDER_NOT_WEBOTS',inputs};

// ---- Release 1.1 (spec 2026-11-10-webots-arm-design.md §6.3, D32): the Webots arm. There is no campaign: the engine evidence is the suites that drive the real Webots, and REG02 re-checks the R1, IR-SIM and
// R-MOCK records of the same commit. The same fail-closed core; `campaign:false` is the one difference.
const LAB=(files)=>({repo:'lab',kind:'vitest',files});
export const SUITES_R11=[
 {id:'arm-static',...V(['tests/unit/arm-fixture.test.ts','tests/unit/capabilities-webots-arm.test.ts','tests/contracts/sim-extension-contracts.test.ts'])},
 {id:'arm-py',repo:'source',kind:'pytest',python:'.venv-webots/bin/python',pythonPath:['robotics/simulation-3d'],files:['robotics/simulation-3d/tests']},
 {id:'arm-worker',...V(['tests/integration/webots-arm-worker.test.ts'])},
 {id:'arm-programs',...V(['tests/integration/webots-arm-programs.test.ts','tests/unit/webots-arm-ports.test.ts','tests/unit/mock-arm-tracking.test.ts'])},
 {id:'arm-bv01',...V(['tests/integration/webots-arm-bv01.test.ts','tests/integration/webots-arm-double.test.ts'])},
 {id:'arm-faults',...V(['tests/integration/webots-arm-faults.test.ts','tests/integration/webots-arm-readiness.test.ts'])},
 {id:'arm-regress',...V(['tests/unit/bv01-mock-golden.test.ts','tests/integration/lab-v2-arm.test.ts','tests/security/webots-authority.test.ts'])},
 {id:'lab-arm-unit',...LAB(['tests/unit/arm-chain.test.ts','tests/unit/webots-coffee.test.ts','tests/unit/twin-workspace.test.ts','tests/integration/webots-launcher.test.ts','tests/integration/runtime-artifact.test.ts'])},
 // one spec per launcher (the pairing code is one-use)
 {id:'lab-e2e-webots-coffee',repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--provider','webots','webots-coffee.spec.ts']},
];
export const CASES_R11={
 WA01:{suites:['arm-static','arm-py']},
 WA02:{suites:['arm-worker']},
 WA03:{suites:['arm-worker','arm-py']},
 WA04:{suites:['arm-programs']},
 WA05:{suites:['arm-bv01']},
 WA06:{suites:['arm-faults']},
 WA07:{suites:['arm-bv01']},
 WA08:{suites:['arm-bv01','lab-arm-unit']},
 INT13:{lab:true,suites:['lab-e2e-webots-coffee','lab-arm-unit']},
 INT14:{suites:['arm-static','arm-regress','arm-faults']},
 REG02:{r1Record:true,irsimRecord:true,mockRegression:true},
};
export const GATES_R11={'G-WA1':['WA01','WA02','WA03'],'G-WA2':['WA04','WA05','WA06','WA07','WA08'],'G-INT3':['INT13','INT14'],'G-REG2':['REG02']};
export const GATE_IDS_R11=Object.keys(GATES_R11);

/** The R1 record this R1.1 record builds on (REG02): a Release 1 record of the SAME source commit, not accepted by the recorder, with its six gates tested. */
export function checkR1Record(doc,sourceCommit){
 const r=[];
 if(!doc||doc.documentType!=='sim-extension-qualification'||doc.release!=='r1')return ['R1_RECORD_NOT_R1'];
 if(doc.accepted!==false)r.push('R1_RECORD_ACCEPTED');
 if(doc.identity?.before?.sourceCommit!==sourceCommit)r.push(`R1_RECORD_COMMIT: ${doc.identity?.before?.sourceCommit??'none'}, this source ${sourceCommit}`);
 const gates=Object.entries(doc.gates??{});if(gates.length!==GATE_IDS.length)r.push('R1_RECORD_GATES');
 for(const [g,x] of gates)if(x.status!=='tested')r.push(`R1_GATE_NOT_TESTED:${g}`);
 return r;
}
/** The recorded inputs of the R1.1 table: the R1 record, its IR-SIM record and the Lab's mock regression, read back from beside qualification.json. The R1 record names the IR-SIM record and the
 * mock regression it was built on: the copies here must be those same bytes, so REG02 cannot be satisfied by a different record of the same commit. */
function inputsR11(m,read){
 const reasons=[],input={},parsed=(ref,missing,corrupt)=>{
  if(!ref?.file||!HEX.test(ref.sha256??'')){reasons.push(missing);return null;}
  const b=read(ref.file);if(!b){reasons.push(missing);return null;}
  if(sha(b)!==ref.sha256){reasons.push(corrupt);return null;}
  try{return JSON.parse(b.toString('utf8'));}catch{reasons.push(corrupt);return null;}};
 const commit=m.identity?.before?.sourceCommit;
 const r1=parsed(m.r1Record,'R1_RECORD_MISSING','R1_RECORD_CORRUPT');
 if(r1){input.r1=r1;reasons.push(...checkR1Record(r1,commit));}
 const irs=parsed(m.irsimRecord,'IRSIM_RECORD_MISSING','IRSIM_RECORD_CORRUPT');
 if(irs){input.irsim=irs;reasons.push(...checkIrsimRecord(irs,commit));if(r1&&r1.irsimRecord?.sha256!==m.irsimRecord.sha256)reasons.push('IRSIM_RECORD_NOT_THE_R1_ONE');}
 const mock=parsed(m.mockRegression,'MOCK_REGRESSION_MISSING','MOCK_REGRESSION_CORRUPT');
 if(mock){input.mock=mock;if(mock.schema!=='lab-v2-regression/1')reasons.push('MOCK_REGRESSION_NOT_LAB_MANIFEST');if(r1&&r1.mockRegression?.sha256!==m.mockRegression.sha256)reasons.push('MOCK_REGRESSION_NOT_THE_R1_ONE');}
 return {input,reasons};
}
export const TABLE_R11={documentType:'sim-extension-qualification',cases:CASES_R11,gates:GATES_R11,suites:SUITES_R11,campaign:false,inputs:inputsR11};
export const qualifyR11=(input)=>qualifyWith(input,TABLE_R11);

export const qualify=(input)=>qualifyWith(input,TABLE);
/** The table follows the record's own release; a record that names neither is checked as R1 and fails on its content. */
export const checkQualification=(m,read)=>m?.release==='r1.1'?check(m,read,TABLE_R11):check(m,read,TABLE);
