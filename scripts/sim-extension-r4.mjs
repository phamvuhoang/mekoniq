// R4 structural table (contracts §9/§10): the same immutable qualification core as R2b, with its own closed suites. A case is `tested` only when its suites ran green AND the artifact reader accepted the input that case
// names (a campaign, the study, the container or web record); a missing input is `not_run` with a reason, never a pass. G3 and G-CAL1 are outside the closing condition: G-CAL1 is `not_run` without --calibration-selftest.
import {checkPlaywrightResult,checkPlaywrightProcess} from './r4-playwright.mjs';
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {qualify,checkQualification} from './irsim-qualification.mjs';
import {checkR2bExecutedFiles} from './sim-extension-r2b.mjs';
const V=(id,files,repo='source')=>({id,repo,kind:'vitest',files});
// one spec per launcher (its pairing code is one-use); alternate ports so a developer's running Lab on 4175/4176 is never touched; the same flags each spec's header documents
const E=(id,spec,sameOrigin=true)=>({id,repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--production-ui',...sameOrigin?['--same-origin']:[],'--provider','mujoco','--mujoco-mobile','--ui-port','42455','--runtime-port','42456',spec]});
export const SUITES_R4=[
 V('drv-contracts',['tests/contracts/drive-contracts.test.ts','tests/contracts/control-profile-admission.test.ts','tests/unit/drive-io.test.ts','tests/unit/drive-fixture.test.ts','tests/unit/study-drive-admission.test.ts']),
 V('drv-model',['tests/unit/mock-drive.test.ts','tests/unit/mujoco-drive.test.ts','tests/unit/drive-experiments.test.ts']),
 V('drv-engine',['tests/integration/mujoco-drive-worker.test.ts','tests/integration/mujoco-drive-mobile.test.ts','tests/integration/mujoco-drive-cell.test.ts','tests/integration/mujoco-drive-view-cost.test.ts','tests/integration/drive-evidence.test.ts']),
 V('cil-controllers',['tests/unit/controller-vectors.test.ts','tests/unit/diff-drive-base.test.ts','tests/unit/joint-follower.test.ts']),
 V('cil-engine',['tests/integration/mujoco-cil-campaign.test.ts','tests/integration/cil-durable-evidence.test.ts']),
 V('tune-unit',['tests/unit/tuning-envelope.test.ts','tests/unit/tuning-metrics.test.ts','tests/unit/bench-signals.test.ts','tests/unit/drive-metrics.test.ts','tests/unit/gain-suggest.test.ts','tests/security/lab-bench.test.ts']),
 V('tune-engine',['tests/integration/mujoco-bench.test.ts','tests/integration/mujoco-bench-campaign.test.ts']),
 V('flt-unit',['tests/unit/drive-faults.test.ts','tests/unit/fault-fixture.test.ts','tests/unit/fault-campaign-table.test.ts','tests/unit/fault-report.test.ts','tests/unit/fault-read-outcome.test.ts']),
 V('flt-engine',['tests/integration/mujoco-drive-faults.test.ts','tests/integration/mujoco-arm-faults.test.ts','tests/integration/lab-fault-gateway.test.ts']),
 V('tray-unit',['tests/unit/tray-fixture.test.ts','tests/unit/tray-inputs.test.ts','tests/unit/tray-experiments.test.ts','tests/unit/tray-oracle.test.ts','tests/unit/tray-verdict.test.ts','tests/unit/physics-comparison.test.ts']),
 V('tray-engine',['tests/integration/mujoco-tray-compile.test.ts','tests/integration/mujoco-tray.test.ts']),
 V('bel-unit',['tests/contracts/belief-contracts.test.ts','tests/unit/belief.test.ts','tests/unit/belief-evidence.test.ts','tests/unit/world-belief.test.ts','tests/unit/pose-estimator-sim.test.ts','tests/unit/sensor-transforms.test.ts','tests/unit/gaussian.test.ts','tests/unit/grasp-config.test.ts','tests/unit/grasp-conditioning.test.ts','tests/unit/perception-report.test.ts']),
 V('bel-engine',['tests/integration/mujoco-belief-pick.test.ts','tests/integration/mujoco-pick-rig.test.ts','tests/unit/pick-rig-fixture.test.ts','tests/unit/pick-rig-outcome.test.ts','tests/unit/perception-study.test.ts','tests/unit/perception-study-verify.test.ts']),
 V('rec-unit',['tests/unit/recovery-policy.test.ts','tests/unit/world-belief-recovery.test.ts']),
 V('rec-engine',['tests/integration/mujoco-recovery-rig.test.ts','tests/integration/mujoco-cell-belief.test.ts']),
 V('cal-unit',['tests/contracts/calibration-record.test.ts','tests/unit/calibration-import.test.ts','tests/unit/parameter-paths.test.ts','tests/unit/least-squares.test.ts','tests/unit/identification.test.ts','tests/unit/maturity.test.ts']),
 V('cal-engine',['tests/integration/bench-prediction.test.ts','tests/integration/identification-selftest.test.ts','tests/integration/identify-cli.test.ts']),
 V('web-ui',['tests/unit/control-workbench.test.ts','tests/unit/control-report.test.ts','tests/unit/belief-view.test.ts','tests/unit/recovery-view.test.ts','tests/unit/fault-report-view.test.ts','tests/unit/fault-timeline.test.ts','tests/unit/drive-fault-schedule.test.ts','tests/unit/design-hint.test.ts','tests/unit/svg-plot.test.ts','tests/unit/tray-preset.test.ts','tests/unit/grasp-mode-request.test.ts'],'lab'),
 V('web-cal-ui',['tests/unit/calibration-view.test.ts','tests/unit/maturity-badge.test.ts'],'lab'),
 E('e2e-control','mujoco-control.spec.ts',false),E('e2e-faults','mujoco-faults.spec.ts'),E('e2e-tray','mujoco-tray.spec.ts'),E('e2e-belief','mujoco-belief.spec.ts'),E('e2e-calibration','mujoco-calibration.spec.ts',false),E('e2e-perf','mujoco-perf.spec.ts'),
 // the replay spec serves its own production preview (tests/support/replay-preview.ts): it is not behind a launcher
 {id:'e2e-replay',repo:'lab',kind:'playwright',command:['node_modules/@playwright/test/cli.js','test','tests/e2e/replay-offline.spec.ts','--reporter=json']},
 V('r4-regression',['tests/unit/bv01-mock-golden.test.ts','tests/integration/portable-tool-closure.test.ts','tests/integration/lab-runtime-artifact.test.ts','tests/unit/sim-extension-qualification.test.ts','tests/unit/r4-readback.test.ts','tests/unit/r4-calibration-readback.test.ts','tests/unit/r4-native-import.test.ts','tests/unit/r4-replay-readback.test.ts','tests/unit/r4-cld02-guards.test.ts'])
];
const cases=(ids,suites,extra={})=>Object.fromEntries(ids.map(id=>[id,{suites,...extra}]));
const REC06='blocked: no nudge force makes a known grip miss with the cup still in view (LEDGER-v11-v13); not tuned to fit';
export const CASES_R4={
 ...cases(['DRV01'],['drv-contracts']),...cases(['DRV02','DRV03','DRV04','DRV05'],['drv-model','drv-engine']),...cases(['DRV06'],['drv-model','drv-engine']),...cases(['DRV07'],['drv-engine']),...cases(['DRV08'],['drv-engine']),
 ...cases(['CIL01'],['cil-controllers']),...cases(['CIL02','CIL03','CIL04','CIL06'],['cil-engine','drv-engine'],{input:'cilCampaign'}),CIL05:{suites:['cil-engine','flt-engine'],input:'cilCampaign'},
 ...cases(['TUNE01','TUNE02','TUNE03'],['tune-unit','tune-engine'],{input:'benchCampaign'}),TUNE04:{suites:['web-ui','e2e-control'],input:'benchCampaign'},TUNE05:{suites:['tune-unit','web-ui'],input:'benchCampaign'},
 ...cases(['FLT01','FLT02','FLT03','FLT04','FLT05'],['flt-unit','flt-engine'],{input:'faultCampaign'}),FLT06:{suites:['web-ui','e2e-faults']},
 ...cases(['TRAY01','TRAY02','TRAY03','TRAY04'],['tray-unit','tray-engine'],{input:'trayCampaign'}),TRAY05:{suites:['tray-unit','web-ui'],input:'trayCampaign'},
 BEL01:{suites:['bel-unit']},...cases(['BEL02','BEL03','BEL04'],['bel-unit','bel-engine']),BEL05:{suites:['bel-engine'],input:'perceptionStudy'},BEL06:{suites:['web-ui','e2e-belief']},
 ...cases(['REC01','REC02','REC03','REC04','REC05'],['rec-unit','rec-engine']),REC06:{notRun:REC06},
 ...cases(['CAL01','CAL02','CAL03','CAL04','CAL05'],['cal-unit','cal-engine'],{optional:'calibrationSelftest'}),CAL06:{suites:['web-cal-ui','e2e-calibration'],optional:'calibrationSelftest'},
 WEB07:{suites:['e2e-control','e2e-faults','e2e-tray','e2e-belief','e2e-calibration'],input:'web'},WEB08:{suites:['e2e-replay'],input:'web'},WEB09:{suites:['e2e-perf'],input:'web'},WEB10:{input:'web'},
 REG05:{suites:['r4-regression'],input:'r2bRecord'},
 CLD01:{input:'containerRecord'},CLD02:{input:'containerRecord'},CLD03:{notRun:'deploy_order_pending'}
};
export const GATES_R4={
 'G-DRV1':['DRV01','DRV02','DRV03','DRV04','DRV05','DRV06','DRV07','DRV08'],'G-CIL1':['CIL01','CIL02','CIL03','CIL04','CIL05','CIL06'],'G-TUNE1':['TUNE01','TUNE02','TUNE03','TUNE04','TUNE05'],
 'G-FLT1':['FLT01','FLT02','FLT03','FLT04','FLT05','FLT06'],'G-TRAY1':['TRAY01','TRAY02','TRAY03','TRAY04','TRAY05'],'G-BEL1':['BEL01','BEL02','BEL03','BEL04','BEL05','BEL06'],
 'G-REC1':['REC01','REC02','REC03','REC04','REC05','REC06'],'G-CAL1':['CAL01','CAL02','CAL03','CAL04','CAL05','CAL06'],'G-WEB2':['WEB07','WEB08','WEB09','WEB10'],'G-REG5':['REG05'],'G-CLOUD2':['CLD01','CLD02','CLD03']
};
/** The gates that must be `tested` before R4 may be called complete (contracts §10). G-CAL1 is recorded separately. */
export const CLOSING_GATES_R4=Object.keys(GATES_R4).filter(g=>g!=='G-CAL1');
const equalKeys=(a,b)=>JSON.stringify(Object.keys(a??{}).sort())===JSON.stringify(Object.keys(b).sort());
export function tableR4(){
 const used=new Set(Object.values(CASES_R4).flatMap(c=>c.suites??[]));
 return {documentType:'sim-extension-qualification',campaign:false,
  // the exact-file check reads a Vitest JSON; a Playwright result has its own counts (the core derives them from stats), and its one spec is named in the suite's command
  checkSuiteResult:(suite,bytes)=>suite.kind==='vitest'?checkR2bExecutedFiles(suite,bytes):checkPlaywrightResult(suite,bytes),cases:CASES_R4,gates:GATES_R4,suites:SUITES_R4.filter(s=>used.has(s.id)),inputs(m,read){const reasons=[];
  if(m.accepted!==false||m.acceptedBy!==null||m.acceptedAt!==null)reasons.push('RECORD_ACCEPTED');
  if(!equalKeys(m.cases,CASES_R4))reasons.push('CASE_TABLE_MISMATCH');
  if(!equalKeys(m.gates,GATES_R4))reasons.push('GATE_TABLE_MISMATCH');
  const actual=m.suites??[];if(actual.length!==used.size||new Set(actual.map(s=>s.id)).size!==actual.length||actual.some(s=>!used.has(s.id)))reasons.push('SUITE_TABLE_MISMATCH');
  for(const su of actual){const required=SUITES_R4.find(s=>s.id===su.id);if(required?.kind==='playwright')reasons.push(...checkPlaywrightProcess(required,su,read));}
  if(!/^[a-f0-9]{40}$/.test(m.lab?.commit??''))reasons.push('LAB_COMMIT_REQUIRED');
  if(!equalKeys(m.artifactDispositions,CASES_R4)||Object.values(m.artifactDispositions??{}).some(x=>!['tested','not_run','failed','blocked_external','blocked'].includes(x?.status)||!Array.isArray(x?.issues)))reasons.push('ARTIFACT_DISPOSITION_SHAPE');
  return {input:{artifactDispositions:m.artifactDispositions},reasons};},adjust(q,input){
   for(const [id,c]of Object.entries(q.cases)){const d=input.artifactDispositions?.[id]??{status:'not_run',issues:['ARTIFACT_READBACK_PENDING']};
    if(d.status!=='tested'&&c.status!=='failed'||d.status==='failed'){c.status=d.status==='blocked'||d.status==='blocked_external'?'not_run':d.status;c.reason=(d.status==='blocked'||d.status==='blocked_external'?d.status+': ':'artifact '+d.status+': ')+d.issues.join('; ');}else if(c.status==='tested')c.evidence.push('artifact:'+id);
   }
   q.notRun=Object.entries(q.cases).filter(([,c])=>c.status!=='tested').map(([id,c])=>({id,reason:c.reason}));
   for(const g of Object.values(q.gates))g.status=g.cases.every(id=>q.cases[id].status==='tested')?'tested':g.cases.some(id=>q.cases[id].status==='failed')?'failed':'not_run';return q;
  }};
}
export const qualifyR4Structure=input=>qualify(input,tableR4());
export function checkR4Structure(m,read){try{return checkQualification(m,read,tableR4());}catch(e){return ['R4_STRUCTURE_INVALID:'+e.message];}}
/** Closed selectors must name real files before any campaign copy or expensive execution. */
export function validateR4Selectors(table,roots){
 for(const suite of table.suites)for(const file of suite.files??[])if(!statSync(join(roots[suite.repo],file),{throwIfNoEntry:false})?.isFile())throw Error('R4_SELECTOR_MISSING:'+suite.id+':'+file);
 for(const suite of table.suites)if(suite.command&&!statSync(join(roots[suite.repo],suite.command[0]),{throwIfNoEntry:false})?.isFile())throw Error('R4_SELECTOR_MISSING:'+suite.id+':'+suite.command[0]);
}
