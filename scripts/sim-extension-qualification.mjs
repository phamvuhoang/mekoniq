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

// ---- Release R2a (spec 2026-11-12-realistic-arm-web-ui-design.md §6.4, D70, D71): the MuJoCo arm (part A), the runtime reachable from the web (B) and the rebuilt twin page (C).
// No campaign: the engine evidence is the suites that drive the real MuJoCo worker. REG03 re-checks the R1.1 record of the same commit and the R1, IR-SIM and R-MOCK records it carries.
// Two statuses the suites cannot express come from `adjust`: G-CLOUD1 is always `blocked_external` (D60: no deployment has been ordered; a CL01 producer and its record format belong to
// that deployment work, so no input of this table can make it tested), and a part A gate is `blocked` (its cases not_run, its suites not run) only when the M00 spike note concludes
// failure (D70). Every input is bound to the record's source commit AND its Lab commit (the Lab adds UI commits under an unchanged pin).
const MOCK_E2E=(id,spec)=>({id,repo:'lab',kind:'playwright',command:['scripts/test-mock-e2e.mjs',spec]});
const LAUNCHER_E2E=(id,provider,spec)=>({id,repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs',...provider?['--provider',provider]:[],spec],venvs:[`.venv-${provider??'irsim'}`]});
export const SUITES_R2A=[
 // part A: the fixture, the engine and the worker (MA01-MA03); RTB is the pinned .venv-algorithm
 {id:'ma-static',...V(['tests/unit/xarm6-fixture.test.ts','tests/unit/capabilities-mujoco-arm.test.ts','tests/unit/arm-cell-scene.test.ts','tests/unit/xarm6-cell-dock.test.ts','tests/contracts/sim3d-mujoco-schema.test.ts'])},
 {id:'ma-rtb',...V(['tests/integration/xarm6-rtb.test.ts']),venvs:['.venv-algorithm']},
 {id:'ma-py',repo:'source',kind:'pytest',python:'.venv-mujoco/bin/python',pythonPath:['robotics/simulation-mujoco'],files:['robotics/simulation-mujoco/tests']},
 {id:'ma-worker',...V(['tests/integration/mujoco-arm-worker.test.ts']),venvs:['.venv-mujoco']},
 {id:'ma-ports',...V(['tests/unit/mujoco-arm-ports.test.ts']),venvs:['.venv-mujoco']},
 // part A: programs, MJ-BV01, faults and the flag (MA04-MA08, INT16)
 {id:'ma-programs',...V(['tests/integration/mujoco-arm-programs.test.ts']),venvs:['.venv-mujoco']},
 // engine-free: the contact state machine, the quintic motion, the sweep geometry (MA04) and the arm report block (MA08)
 {id:'ma-contact',...V(['tests/unit/mock-arm-contact.test.ts','tests/unit/arm-motion.test.ts','tests/unit/arm-collision-geometry.test.ts','tests/unit/arm-plant-report.test.ts'])},
 {id:'ma-bv01',...V(['tests/integration/mujoco-arm-bv01.test.ts','tests/integration/mujoco-arm-gateway.test.ts']),venvs:['.venv-mujoco']},
 {id:'ma-faults',...V(['tests/integration/mujoco-arm-faults.test.ts','tests/integration/mujoco-arm-readiness.test.ts']),venvs:['.venv-mujoco']},
 // part B: the gateway matrix, the paced step on both runners, the container (built by the recorder from this commit: rt-image)
 {id:'rt-remote',...V(['tests/integration/lab-runtime-remote.test.ts'])},
 {id:'rt-paced',...V(['tests/unit/paced-step.test.ts','tests/integration/lab-v2-paced-step.test.ts','tests/integration/irsim-plant-port.test.ts']),venvs:['.venv-irsim']},
 {id:'rt-container',...V(['tests/integration/lab-runtime-container.test.ts']),image:true},
 // regressions: the mock BV01 golden, the exported closure (mujoco_worker and its licences), this table
 {id:'regress',...V(['tests/unit/bv01-mock-golden.test.ts','tests/integration/portable-tool-closure.test.ts','tests/integration/lab-runtime-artifact.test.ts','tests/unit/sim-extension-qualification.test.ts'])},
 // the Lab: unit tests by part
 {id:'lab-rt-unit',...LAB(['tests/unit/fetch-event-source.test.ts','tests/unit/twin-runtime-remote.test.ts','tests/unit/runtime-target.test.ts','tests/unit/runtime-stream.test.ts','tests/unit/runtime-compatibility.test.ts'])},
 {id:'lab-ui-unit',...LAB(['tests/unit/twin-shell.test.ts','tests/unit/twin-problems.test.ts','tests/unit/twin-keys.test.ts','tests/unit/twin-notes.test.ts','tests/unit/sample-buffer.test.ts','tests/unit/live-playback.test.ts','tests/unit/twin3d-structure.test.ts','tests/unit/workspace-conditional-items.test.ts','tests/unit/twin-workspace.test.ts','tests/unit/playwright-config.test.ts'])},
 {id:'lab-arm-unit',...LAB(['tests/unit/arm-mesh.test.ts','tests/unit/mujoco-coffee.test.ts','tests/unit/runtime-popover.test.ts','tests/integration/mujoco-launcher.test.ts','tests/integration/runtime-artifact.test.ts'])},
 // the Lab in a browser: one spec per launcher run (the pairing code is one-use); arm-mesh and arm-cell need only the Lab UI the mock launcher serves
 MOCK_E2E('lab-e2e-remote-origin','remote-origin.spec.ts'),
 MOCK_E2E('lab-e2e-twin-layout','twin-layout.spec.ts'),MOCK_E2E('lab-e2e-twin-polish','twin-polish.spec.ts'),MOCK_E2E('lab-e2e-twin-transport','twin-transport.spec.ts'),
 MOCK_E2E('lab-e2e-twin-workspace','twin-workspace.spec.ts'),MOCK_E2E('lab-e2e-brand-accessibility','brand-accessibility.spec.ts'),
 MOCK_E2E('lab-e2e-arm-mesh','arm-mesh.spec.ts'),MOCK_E2E('lab-e2e-arm-cell','arm-cell.spec.ts'),
 LAUNCHER_E2E('lab-e2e-mujoco-coffee','mujoco','mujoco-coffee.spec.ts'),LAUNCHER_E2E('lab-e2e-mujoco-mesh-fallback','mujoco','mujoco-mesh-fallback.spec.ts'),
 LAUNCHER_E2E('lab-e2e-irsim-journey',null,'irsim-journey.spec.ts'),LAUNCHER_E2E('lab-e2e-webots-coffee','webots','webots-coffee.spec.ts'),
];
const CLOUD_REASON='blocked_external: no Cloud Run deployment has been ordered (D60); CL01 runs on a deployed service only, and its producer and record format belong to that deployment work';
export const CASES_R2A={
 MA01:{suites:['ma-static','ma-rtb','ma-py']},
 MA02:{suites:['ma-worker','ma-py']},
 MA03:{suites:['ma-py','ma-ports','ma-worker']},
 MA04:{suites:['ma-programs','ma-contact']},
 MA05:{suites:['ma-bv01']},
 MA06:{suites:['ma-faults'],note:'ruled 2026-11-13: with the pads\' friction lowered the cup slips during the lift, so the transfer is refused at the lift check (TRANSFER_REJECTED, run needs_attention) and CUP_DROPPED latches when the cup leaves the pads; the case is an explicit failure at the lift check and/or CUP_DROPPED, never completed, the gripper never commanded open. The weakened-joint fault runs on a temporary copy of the worker root; the occupied-stand run ends in ARM_COLLISION before the worker\'s occupied refusal, which is proven at worker and ports level'},
 MA07:{suites:['ma-bv01']},
 MA08:{suites:['ma-bv01','ma-contact']},
 RT01:{suites:['rt-remote']},
 RT02:{suites:['lab-rt-unit']},
 RT03:{suites:['rt-paced'],note:'ruled 2026-11-13: on the fixed-step runner, paced and unpaced evidence are identical for the same action sequence and the unpaced golden is unchanged with no wall-clock call; a paced run cannot reproduce the 500-tick golden (a paced step carries at most 50 ticks)'},
 RT04:{lab:true,suites:['lab-e2e-remote-origin']},
 RT05:{suites:['rt-container'],note:'the image is built by the recorder for this machine\'s architecture from the recorded commit; a container run is never evidence for G-MA1/G-MA2 (D50); linux/amd64 has only run under emulation, where MJ-BV01 stops with PLANT_UNSTABLE (cause unknown), and real amd64 hardware is untested'},
 CL01:{notRun:CLOUD_REASON},
 UI01:{lab:true,suites:['lab-ui-unit','lab-e2e-twin-layout']},
 UI02:{lab:true,suites:['lab-ui-unit','lab-e2e-twin-layout','lab-e2e-twin-polish']},
 UI03:{lab:true,suites:['lab-ui-unit','lab-e2e-twin-transport','lab-e2e-twin-polish']},
 UI04:{lab:true,suites:['lab-ui-unit','lab-e2e-brand-accessibility','lab-e2e-twin-layout','lab-e2e-twin-workspace']},
 UI05:{lab:true,suites:['lab-arm-unit','lab-e2e-arm-mesh','lab-e2e-arm-cell','lab-e2e-mujoco-mesh-fallback'],note:'ruled 2026-11-13: the launcher-level check is the MuJoCo launcher spec (mujoco-mesh-fallback); the plan\'s mock-launcher e2e was replaced by UI-only browser specs (arm-mesh, arm-cell). The 3D view also draws the cell\'s two supports (assumed geometry of the simulated cell) and an illustrative mount and legs that are not simulated'},
 INT15:{lab:true,suites:['lab-e2e-mujoco-coffee','lab-arm-unit']},
 INT16:{lab:true,suites:['regress','ma-faults','lab-e2e-irsim-journey','lab-e2e-webots-coffee'],mockRegression:true,note:'the mock e2e on the new UI is the R-MOCK regression of the same commit (mock-regression.json)'},
 REG03:{r11Record:true,r1Record:true,irsimRecord:true,mockRegression:true},
};
export const GATES_R2A={'G-MA1':['MA01','MA02','MA03'],'G-MA2':['MA04','MA05','MA06','MA07','MA08'],'G-RT1':['RT01','RT02','RT03','RT04'],'G-RT2':['RT05'],
 'G-UI1':['UI01','UI02','UI03','UI04'],'G-INT4':['UI05','INT15','INT16'],'G-REG3':['REG03'],'G-CLOUD1':['CL01']};
export const GATE_IDS_R2A=Object.keys(GATES_R2A);
/** Part A of R2a (D70): the gates that need MuJoCo, the only ones --blocked may name. */
export const PART_A_GATES=['G-MA1','G-MA2','G-RT2','G-INT4'];
export const SPIKE_NOTE='docs/research/2026-11-mujoco-arm-spike.md';

/** The M00 spike note's own verdict: its "**Kết luận: ĐẠT …**" / "**Kết luận: TRƯỢT …**" line; null when it states neither. */
export const spikeConclusion=(text)=>{const m=/\*\*Kết luận:\s*(ĐẠT|TRƯỢT)/u.exec(String(text??''));return m?(m[1]==='ĐẠT'?'pass':'fail'):null;};
/** Why a --blocked request is refused ([] when it may be recorded): part A gates only, a reason, and a spike note that concludes failure (D70). */
export function checkBlocked({gates,reason},spikeText){
 const r=[];
 if(!gates?.length)r.push('BLOCKED_NO_GATE');
 for(const g of gates??[])if(!PART_A_GATES.includes(g))r.push(`BLOCKED_NOT_PART_A:${g} (only ${PART_A_GATES.join(', ')})`);
 if(!(typeof reason==='string'&&reason.trim()))r.push('BLOCKED_REASON_MISSING');
 const c=spikeConclusion(spikeText);if(c!=='fail')r.push(`BLOCKED_SPIKE_NOT_FAILED: ${SPIKE_NOTE} concludes ${c==='pass'?'ĐẠT (pass)':'nothing'}; a part A gate is blocked only when the spike failed`);
 return r;
}
/** The R1.1 record this R2a record builds on (REG03): a Release 1.1 record of the SAME source commit, not accepted by the recorder, with its four gates tested. */
export function checkR11Record(doc,sourceCommit){
 const r=[];
 if(!doc||doc.documentType!=='sim-extension-qualification'||doc.release!=='r1.1')return ['R11_RECORD_NOT_R11'];
 if(doc.accepted!==false)r.push('R11_RECORD_ACCEPTED');
 if(doc.identity?.before?.sourceCommit!==sourceCommit)r.push(`R11_RECORD_COMMIT: ${doc.identity?.before?.sourceCommit??'none'}, this source ${sourceCommit}`);
 const gates=Object.entries(doc.gates??{});if(JSON.stringify(gates.map(([g])=>g).sort())!==JSON.stringify([...GATE_IDS_R11].sort()))r.push('R11_RECORD_GATES');
 for(const [g,x] of gates)if(x.status!=='tested')r.push(`R11_GATE_NOT_TESTED:${g}`);
 return r;
}
/** R2a binds its inputs to the Lab commit of the record being made (labCommit): the R1.1, R1 and IR-SIM records' own `lab.commit`, and the mock regression's start and end Lab commit. */
export function checkLabCommits({r11,r1,irsim,mock},labCommit){
 const r=[],c=(doc,code)=>{if(doc&&doc.lab?.commit!==labCommit)r.push(`${code}: ${doc.lab?.commit??'none'}, this record's Lab ${labCommit??'none'}`);};
 c(r11,'R11_RECORD_LAB_COMMIT');c(r1,'R1_RECORD_LAB_COMMIT');c(irsim,'IRSIM_RECORD_LAB_COMMIT');
 if(mock){const a=mock.identity?.start?.lab?.commit,b=mock.identity?.end?.lab?.commit;if(a!==labCommit||b!==labCommit)r.push(`MOCK_REGRESSION_LAB_COMMIT: start ${a??'none'}, end ${b??'none'}, this record's Lab ${labCommit??'none'}`);}
 return r;
}
function adjustR2a(q,input){
 const cases={...q.cases,CL01:{status:'not_run',evidence:[],reason:CLOUD_REASON}},gates={...q.gates,'G-CLOUD1':{...q.gates['G-CLOUD1'],status:'blocked_external'}};
 for(const g of input.blocked?.gates??[])if(gates[g])gates[g]={...gates[g],status:'blocked',reason:input.blocked.reason};
 return {cases,gates,notRun:[...q.notRun.filter(n=>n.id!=='CL01'),{id:'CL01',reason:CLOUD_REASON}]};
}
/** The recorded inputs of the R2a table, read back from beside qualification.json: the R1.1 record and, byte for byte, the R1, IR-SIM and mock records it carries, all of the record's
 * source and Lab commits; the spike note copy when the record names a block. G-CLOUD1 is never anything but blocked_external, and a record naming a CL01 result is refused. A record is never accepted: `accepted` is false whatever reviewer it names (acceptance is a human-written sidecar). */
function inputsR2a(m,read){
 const reasons=[],input={},raw=(ref,missing,corrupt)=>{
  if(!ref?.file||!HEX.test(ref.sha256??'')){reasons.push(missing);return null;}
  const b=read(ref.file);if(!b){reasons.push(missing);return null;}
  if(sha(b)!==ref.sha256){reasons.push(corrupt);return null;}
  return b.toString('utf8');},parsed=(...a)=>{const t=raw(...a);if(t===null)return null;try{return JSON.parse(t);}catch{reasons.push(a[2]);return null;}};
 if(m.accepted!==false)reasons.push('RECORD_ACCEPTED: acceptance is recorded only in a human-written acceptance.json beside the record');
 const commit=m.identity?.before?.sourceCommit;
 const r11=parsed(m.r11Record,'R11_RECORD_MISSING','R11_RECORD_CORRUPT');
 if(r11){input.r11=r11;reasons.push(...checkR11Record(r11,commit));}
 const r1=parsed(m.r1Record,'R1_RECORD_MISSING','R1_RECORD_CORRUPT');
 if(r1){input.r1=r1;reasons.push(...checkR1Record(r1,commit));if(r11&&r11.r1Record?.sha256!==m.r1Record.sha256)reasons.push('R1_RECORD_NOT_THE_R11_ONE');}
 const irs=parsed(m.irsimRecord,'IRSIM_RECORD_MISSING','IRSIM_RECORD_CORRUPT');
 if(irs){input.irsim=irs;reasons.push(...checkIrsimRecord(irs,commit));if(r11&&r11.irsimRecord?.sha256!==m.irsimRecord.sha256)reasons.push('IRSIM_RECORD_NOT_THE_R11_ONE');}
 const mock=parsed(m.mockRegression,'MOCK_REGRESSION_MISSING','MOCK_REGRESSION_CORRUPT');
 if(mock){input.mock=mock;if(mock.schema!=='lab-v2-regression/1')reasons.push('MOCK_REGRESSION_NOT_LAB_MANIFEST');if(r11&&r11.mockRegression?.sha256!==m.mockRegression.sha256)reasons.push('MOCK_REGRESSION_NOT_THE_R11_ONE');}
 reasons.push(...checkLabCommits({r11,r1,irsim:irs,mock},m.lab?.commit));
 if(m.cl01!==undefined)reasons.push('CL01_RESULT_NOT_ACCEPTED: no CL01 producer exists in this release; G-CLOUD1 stays blocked_external');
 if(m.gates?.['G-CLOUD1']?.status!=='blocked_external')reasons.push(`CLOUD_GATE_NOT_BLOCKED_EXTERNAL: ${m.gates?.['G-CLOUD1']?.status??'missing'}`);
 if(m.blocked){const note=raw(m.blocked.spikeNote,'SPIKE_NOTE_MISSING','SPIKE_NOTE_CORRUPT');reasons.push(...checkBlocked(m.blocked,note));input.blocked={gates:m.blocked.gates,reason:m.blocked.reason};}
 return {input,reasons};
}
/** The R2a table with the given part A gates blocked: their cases are not_run with the reason, and a suite that serves only blocked cases is not part of the table (not run, not required). */
export function tableR2a(blocked=[],reason=''){
 const out=new Set(blocked.flatMap(g=>GATES_R2A[g]??[]));
 const cases=Object.fromEntries(Object.entries(CASES_R2A).map(([id,c])=>[id,out.has(id)?{notRun:`blocked: ${reason||'part A blocked'} (${blocked.find(g=>GATES_R2A[g]?.includes(id))})`}:c]));
 const used=new Set(Object.values(cases).flatMap(c=>c.suites??[]));
 return {documentType:'sim-extension-qualification',cases,gates:GATES_R2A,suites:SUITES_R2A.filter(s=>used.has(s.id)),campaign:false,inputs:inputsR2a,adjust:adjustR2a};
}

// ---- pre-flight (every release): refuse before a long recording what would fail it later; it changes nothing in a record. Probes are injected so each check is testable.
/** The Python environments a planned recording uses: each pytest suite's interpreter, the venvs the R2a suites name, and the releases' own steps (R1: algorithm oracles and the
 * Webots campaign; R1.1: the Webots arm worker). */
export function plannedVenvs(release,suites){
 const v=new Set(suites.flatMap(s=>[...s.python?[s.python.split('/')[0]]:[],...s.venvs??[]]));
 if(release==='r1')for(const x of ['.venv-algorithm','.venv-webots'])v.add(x);
 if(release==='r1.1')v.add('.venv-webots');
 return [...v].sort();
}
/** Whether a planned step starts the Webots application: R1's campaign and R1.1's arm suites always do; in R2a only the Webots launcher spec does. */
export const startsWebots=(release,suites)=>release!=='r2a'||suites.some(s=>(s.command??[]).includes('webots'));
/** The console session's lock state from `ioreg -n Root -d1 -a` (a plist): CGSSessionScreenIsLocked true. */
export const screenLockedFromIoreg=(text)=>/<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(String(text??''));
/** [{id,ok,code?,message}] for docker, python-env and screen; probes: {docker:()=>bool, exists:(venvRelPath)=>bool, screenLocked:()=>bool, platform}. */
export function preflight({release,suites},probes){
 const out=[],image=suites.some(s=>s.image);
 out.push(!image?{id:'docker',ok:true,message:'no container suite planned'}:probes.docker()?{id:'docker',ok:true,message:'docker info succeeded'}
  :{id:'docker',ok:false,code:'DOCKER_UNAVAILABLE',message:'`docker info` failed: start Docker (OrbStack) first; the container suite (RT05) needs it'});
 const venvs=plannedVenvs(release,suites);
 for(const v of venvs)if(!probes.exists(`${v}/bin/python`))out.push({id:'python-env',ok:false,code:`PYTHON_ENV_MISSING:${v}`,message:`${v}/bin/python is missing (provision it from its lock: node scripts/bootstrap-portable-simulation.mjs)`});
 if(!out.some(c=>c.id==='python-env'))out.push({id:'python-env',ok:true,message:`present: ${venvs.join(', ')||'none planned'}`});
 out.push(probes.platform!=='darwin'||!startsWebots(release,suites)?{id:'screen',ok:true,message:probes.platform!=='darwin'?'not macOS':'nothing planned starts the Webots application'}
  :probes.screenLocked()?{id:'screen',ok:false,code:'SCREEN_LOCKED',message:'the console session is locked and the Webots application does not come up behind a locked screen (its readiness probe would time out): unlock the screen and run the recording under caffeinate -dims'}
  :{id:'screen',ok:true,message:'console session unlocked'});
 return out;
}
export const qualifyR2a=(input)=>qualifyWith(input,tableR2a(input.blocked?.gates??[],input.blocked?.reason));

export const qualify=(input)=>qualifyWith(input,TABLE);
/** The table follows the record's own release; a record that names none of them is checked as R1 and fails on its content. */
export const checkQualification=(m,read)=>m?.release==='r2a'?check(m,read,tableR2a(m.blocked?.gates??[],m.blocked?.reason)):m?.release==='r1.1'?check(m,read,TABLE_R11):check(m,read,TABLE);
