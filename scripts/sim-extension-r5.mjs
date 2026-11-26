// R5 structural table (contracts §8): 48 cases and the nine closing gates of R5, each case naming the suites that must be green. Same immutable qualification core as R4 (`qualify`).
// What this table does NOT do: it does not record anything. A record needs the full chain (Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5, hours, and the owned-CI step stops the
// local Supabase stack), which runs only on the user's consent. Cases whose feature R5 did not build (virtual I/O, cut with E14) say so here and stay `not_run`.
// G-BENCH1 and G-SAFE1 are outside R5 and `blocked_external` in every record; nothing here is `accepted`.
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {qualify,checkQualification} from './irsim-qualification.mjs';
import {checkPlaywrightResult,checkPlaywrightProcess} from './r4-playwright.mjs';
import {checkR2bExecutedFiles} from './sim-extension-r2b.mjs';
const V=(id,files,repo='source')=>({id,repo,kind:'vitest',files});
// one spec per launcher (its pairing code is one-use); alternate ports so a developer's running Lab on 4175/4176 is never touched
const E=(id,spec,provider,...extra)=>({id,repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--same-origin','--provider',provider,...extra,'--ui-port','42455','--runtime-port','42456',spec]});
export const SUITES_R5=[
 V('dev-unit',['tests/unit/electrical-profiles.test.ts','tests/contracts/electrical-contracts.test.ts','tests/unit/electrical-description.test.ts','tests/unit/electrical-catalog.test.ts','tests/unit/electrical-design.test.ts','tests/unit/electrical-fixture.test.ts','tests/unit/electrical-drive-derivation.test.ts']),
 V('ioa-unit',['tests/unit/electrical-allocate.test.ts','tests/unit/electrical-compile.test.ts']),
 V('net-erc-unit',['tests/unit/electrical-netlist.test.ts','tests/unit/electrical-rules.test.ts']),
 V('doc-unit',['tests/unit/electrical-documents.test.ts','tests/unit/electrical-package.test.ts','tests/integration/lab-hardware-cli.test.ts','tests/integration/electrical-gateway.test.ts']),
 V('tco-unit',['tests/unit/electrical-bom.test.ts','tests/unit/electrical-tco.test.ts']),
 V('stp-unit',['tests/contracts/stop-contracts.test.ts','tests/unit/stop-functions.test.ts','tests/unit/stop-metrics.test.ts','tests/unit/stop-report.test.ts','tests/unit/stop-hint.test.ts','tests/unit/stop-fixture.test.ts','tests/unit/stop-campaign-table.test.ts','tests/unit/world-stop-tick.test.ts']),
 V('stp-engine',['tests/integration/mujoco-stop.test.ts']),
 V('web-unit',['tests/unit/electrical-view.test.ts','tests/unit/diagnostics.test.ts','tests/unit/samples.test.ts','tests/unit/twin-shell.test.ts'],'lab'),
 E('e2e-electrical','webots-electrical.spec.ts','webots'),
 // engineering mobile runs with drive evidence and the drive-fault studio exist only on the MuJoCo mobile launcher
 E('e2e-diagnostics','mujoco-diagnostics.spec.ts','mujoco','--mujoco-mobile'),
 {id:'e2e-samples',repo:'lab',kind:'playwright',command:['node_modules/@playwright/test/cli.js','test','tests/e2e/samples-offline.spec.ts','--reporter=json']},
];
const cases=(ids,suites,extra={})=>Object.fromEntries(ids.map(id=>[id,{suites,...extra}]));
export const CASES_R5={
 ...cases(['DEV01','DEV02','DEV03','DEV04','DEV05','DEV06'],['dev-unit']),
 ...cases(['IOA01','IOA02','IOA03','IOA04','IOA05'],['ioa-unit']),
 ...cases(['NET01','NET02','NET03','ERC01','ERC02','ERC03','ERC04'],['net-erc-unit']),
 ...cases(['SAF01'],['dev-unit','net-erc-unit']),SAF02:{suites:['doc-unit']},
 ...cases(['DOC01','DOC02','DOC04'],['doc-unit']),DOC03:{suites:['doc-unit'],input:'hardwarePackage'},...cases(['TCO01','TCO02'],['tco-unit']),
 ...cases(['STP01','STP02','STP05','STP07'],['stp-unit']),...cases(['STP03','STP04'],['stp-unit','stp-engine']),STP06:{suites:['stp-unit','stp-engine'],input:'stopCampaign'},
 VIO01:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut; the plan allows it)'},VIO02:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},VIO03:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},VIO04:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},
 DGN01:{suites:['web-unit','e2e-electrical']},DGN02:{suites:['web-unit','e2e-diagnostics']},
 DGN03:{suites:['web-unit','e2e-samples']},DGN04:{suites:['web-unit','e2e-diagnostics']},
 WEB11:{suites:['web-unit','e2e-samples']},WEB12:{suites:['e2e-samples']},WEB13:{suites:['web-unit','e2e-samples']},
 REG06:{input:'r4Record'},
 CLD04:{input:'containerRecord'},CLD05:{input:'containerRecord'},CLD06:{notRun:'deploy_order_pending'}
};
export const GATES_R5={
 'G-DEV1':['DEV01','DEV02','DEV03','DEV04','DEV05','DEV06'],'G-ELE1':['IOA01','IOA02','IOA03','IOA04','IOA05','NET01','NET02','NET03','ERC01','ERC02','ERC03','ERC04','SAF01','SAF02'],
 'G-DOC1':['DOC01','DOC02','DOC03','DOC04','TCO01','TCO02'],'G-STP1':['STP01','STP02','STP03','STP04','STP05','STP06','STP07'],'G-VIO1':['VIO01','VIO02','VIO03','VIO04'],
 'G-DGN1':['DGN01','DGN02','DGN03','DGN04'],'G-WEB3':['WEB11','WEB12','WEB13'],'G-REG6':['REG06'],'G-CLOUD3':['CLD04','CLD05','CLD06']
};
/** Outside R5: recorded `blocked_external` in every record, never derived from a case. */
export const EXTERNAL_GATES_R5={'G-BENCH1':'real devices on an isolated bench, with a signed measurement record','G-SAFE1':'risk assessment, design and testing of safety functions by a qualified person, signed'};
/** The nine gates that close R5 when every one is `tested`. */
export const CLOSING_GATES_R5=Object.keys(GATES_R5);
const equalKeys=(a,b)=>JSON.stringify(Object.keys(a??{}).sort())===JSON.stringify(Object.keys(b).sort());
export function tableR5(){
 const used=new Set(Object.values(CASES_R5).flatMap(c=>c.suites??[]));
 return {documentType:'sim-extension-qualification',campaign:false,
  // the exact-file check reads a Vitest JSON; a Playwright result has its own counts, and its one spec is named in the suite's command
  checkSuiteResult:(suite,bytes)=>suite.kind==='vitest'?checkR2bExecutedFiles(suite,bytes):checkPlaywrightResult(suite,bytes),cases:CASES_R5,gates:GATES_R5,suites:SUITES_R5.filter(s=>used.has(s.id)),inputs(m,read){const reasons=[];
  if(m.accepted!==false||m.acceptedBy!==null||m.acceptedAt!==null)reasons.push('RECORD_ACCEPTED');
  if(!equalKeys(m.cases,CASES_R5))reasons.push('CASE_TABLE_MISMATCH');
  if(!equalKeys(m.gates,GATES_R5))reasons.push('GATE_TABLE_MISMATCH');
  if(!equalKeys(m.externalGates,EXTERNAL_GATES_R5)||Object.values(m.externalGates??{}).some(g=>g.status!=='blocked_external'||g.accepted!==false))reasons.push('EXTERNAL_GATES_MISMATCH');
  const actual=m.suites??[];if(actual.length!==used.size||new Set(actual.map(s=>s.id)).size!==actual.length||actual.some(s=>!used.has(s.id)))reasons.push('SUITE_TABLE_MISMATCH');
  for(const su of actual){const required=SUITES_R5.find(s=>s.id===su.id);if(required?.kind==='playwright')reasons.push(...checkPlaywrightProcess(required,su,read));}
  if(!/^[a-f0-9]{40}$/.test(m.lab?.commit??''))reasons.push('LAB_COMMIT_REQUIRED');
  if(!equalKeys(m.artifactDispositions,CASES_R5)||Object.values(m.artifactDispositions??{}).some(x=>!['tested','not_run','failed','blocked_external','blocked'].includes(x?.status)||!Array.isArray(x?.issues)))reasons.push('ARTIFACT_DISPOSITION_SHAPE');
  return {input:{artifactDispositions:m.artifactDispositions},reasons};},adjust(q,input){
   for(const [id,c]of Object.entries(q.cases)){const d=input.artifactDispositions?.[id]??{status:'not_run',issues:['ARTIFACT_READBACK_PENDING']};
    if(d.status!=='tested'&&c.status!=='failed'||d.status==='failed'){c.status=d.status==='blocked'||d.status==='blocked_external'?'not_run':d.status;c.reason=(d.status==='blocked'||d.status==='blocked_external'?d.status+': ':'artifact '+d.status+': ')+d.issues.join('; ');}else if(c.status==='tested')c.evidence.push('artifact:'+id);
   }
   q.notRun=Object.entries(q.cases).filter(([,c])=>c.status!=='tested').map(([id,c])=>({id,reason:c.reason}));
   for(const g of Object.values(q.gates))g.status=g.cases.every(id=>q.cases[id].status==='tested')?'tested':g.cases.some(id=>q.cases[id].status==='failed')?'failed':'not_run';return q;
  }};
}
export const qualifyR5Structure=input=>qualify(input,tableR5());
export function checkR5Structure(m,read){try{return checkQualification(m,read,tableR5());}catch(e){return ['R5_STRUCTURE_INVALID:'+e.message];}}
/** Gates the user may cut from R5 and the cases each cut leaves not_run (contracts §9: without E14, "R5 không có I/O ảo"). */
export const CUTTABLE_R5={'G-VIO1':{cases:['VIO01','VIO02','VIO03','VIO04'],releaseName:'R5 không có I/O ảo'}};
/**
 * The closing decision, apart from reading a record (checkR5Structure / verifyR5Directory accept a partial candidate whose not_run cases say why). Closing needs every gate of the
 * decided scope `tested`, no failed case, every exception with a reason, and only these not_run cases: the cut gates' own cases, and CLD06 when — and only when — a CLD06
 * supplement was checked (checkCloudRunR5Evidence against this record's exact bytes) and returned no issue. G-CLOUD3 then closes on CLD04 + CLD05 tested plus that supplement.
 * Call it on a record that verifyR5Directory already read back without an issue.
 */
export function checkR5Closing(m,{cut=[],cloudSupplementIssues=null}={}){
 const issues=[],bad=cut.filter(g=>!CUTTABLE_R5[g]);if(bad.length)return {closed:false,releaseName:null,issues:bad.map(g=>'CUT_NOT_ALLOWED:'+g)};
 const allowed=new Set(cut.flatMap(g=>CUTTABLE_R5[g].cases)),cloud=Array.isArray(cloudSupplementIssues)&&cloudSupplementIssues.length===0;if(cloud)allowed.add('CLD06');
 if(m?.release!=='r5'||m.accepted!==false)issues.push('NOT_AN_R5_CANDIDATE');
 if(!equalKeys(m?.cases,CASES_R5)||!equalKeys(m?.gates,GATES_R5))return {closed:false,releaseName:null,issues:[...issues,'TABLE_MISMATCH']};
 for(const [id,c] of Object.entries(m.cases)){
  if(c.status==='failed')issues.push('CASE_FAILED:'+id);
  else if(c.status!=='tested'){if(!allowed.has(id))issues.push('CASE_NOT_TESTED:'+id);if(!/\S/.test(c.reason??''))issues.push('EXCEPTION_WITHOUT_REASON:'+id);}
 }
 if(Array.isArray(cloudSupplementIssues)&&cloudSupplementIssues.length)issues.push(...cloudSupplementIssues.map(x=>'CLD06_SUPPLEMENT:'+x));
 for(const g of CLOSING_GATES_R5){
  if(cut.includes(g)){if(m.gates[g].status==='tested')issues.push('CUT_GATE_TESTED:'+g);continue;}
  const closes=m.gates[g].status==='tested'||g==='G-CLOUD3'&&cloud&&GATES_R5[g].every(id=>id==='CLD06'||m.cases[id].status==='tested');
  if(!closes)issues.push('GATE_NOT_TESTED:'+g);
 }
 for(const g of Object.keys(EXTERNAL_GATES_R5))if(m.externalGates?.[g]?.status!=='blocked_external'||m.externalGates[g].accepted!==false)issues.push('EXTERNAL_GATE:'+g);
 const u=[...new Set(issues)];
 return {closed:u.length===0,releaseName:u.length?null:cut.length?cut.map(g=>CUTTABLE_R5[g].releaseName).join(', '):'R5',issues:u};
}
export function validateR5Selectors(table,roots){
 for(const suite of table.suites)for(const file of suite.files??[])if(!statSync(join(roots[suite.repo],file),{throwIfNoEntry:false})?.isFile())throw Error('R5_SELECTOR_MISSING:'+suite.id+':'+file);
 for(const suite of table.suites)if(suite.command&&!statSync(join(roots[suite.repo],suite.command[0]),{throwIfNoEntry:false})?.isFile())throw Error('R5_SELECTOR_MISSING:'+suite.id+':'+suite.command[0]);
}
