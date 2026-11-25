// R5 structural table (contracts §8): 48 cases and the nine closing gates of R5, each case naming the suites that must be green. Same immutable qualification core as R4 (`qualify`).
// What this table does NOT do: it does not record anything. A record needs the full chain (Lab regression → IR-SIM → r1 → r1.1 → r2a → r2b → r4 → r5, hours, and the owned-CI step stops the
// local Supabase stack), which runs only on the user's consent. Cases whose feature R5 did not build (virtual I/O, mouse picking, the twin alarm marker) say so here and stay `not_run`.
// G-BENCH1 and G-SAFE1 are outside R5 and `blocked_external` in every record; nothing here is `accepted`.
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {qualify,checkQualification} from './irsim-qualification.mjs';
const V=(id,files,repo='source')=>({id,repo,kind:'vitest',files});
// one spec per launcher (its pairing code is one-use); alternate ports so a developer's running Lab on 4175/4176 is never touched
const E=(id,spec,provider)=>({id,repo:'lab',kind:'playwright',command:['scripts/test-irsim-e2e.mjs','--same-origin','--provider',provider,'--ui-port','42455','--runtime-port','42456',spec]});
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
 {id:'e2e-samples',repo:'lab',kind:'playwright',command:['node_modules/@playwright/test/cli.js','test','tests/e2e/samples-offline.spec.ts','--reporter=json']},
];
const cases=(ids,suites,extra={})=>Object.fromEntries(ids.map(id=>[id,{suites,...extra}]));
export const CASES_R5={
 ...cases(['DEV01','DEV02','DEV03','DEV04','DEV05','DEV06'],['dev-unit']),
 ...cases(['IOA01','IOA02','IOA03','IOA04','IOA05'],['ioa-unit']),
 ...cases(['NET01','NET02','NET03','ERC01','ERC02','ERC03','ERC04'],['net-erc-unit']),
 ...cases(['SAF01'],['dev-unit','net-erc-unit']),SAF02:{suites:['doc-unit']},
 ...cases(['DOC01','DOC02','DOC03','DOC04'],['doc-unit']),...cases(['TCO01','TCO02'],['tco-unit']),
 ...cases(['STP01','STP02','STP05','STP07'],['stp-unit']),...cases(['STP03','STP04'],['stp-unit','stp-engine']),STP06:{suites:['stp-unit','stp-engine'],input:'stopCampaign'},
 VIO01:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut; the plan allows it)'},VIO02:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},VIO03:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},VIO04:{notRun:'vio_cut: R5 has no virtual I/O (E14 cut)'},
 DGN01:{suites:['web-unit','e2e-electrical']},DGN02:{notRun:'not_built: an axis is chosen from a keyboard-operable list; picking a wheel or joint in the 2D/3D twin is not implemented'},
 DGN03:{suites:['web-unit']},DGN04:{notRun:'not_built: an alarm jumps to its tick, but the twin does not mark the entity with an outline and icon; there is no end-to-end run of the jump'},
 WEB11:{suites:['web-unit','e2e-samples']},WEB12:{suites:['e2e-samples']},WEB13:{suites:['web-unit','e2e-samples']},
 REG06:{notRun:'chain_not_run: needs the full recording chain at one tuple; its owned-CI step stops the local Supabase stack, so it waits for the user'},
 CLD04:{input:'containerRecord'},CLD05:{notRun:'native_linux_x86_64_host_required: Python tests of the tool roots on a pushed branch; the amd64 image build is recorded in container.json'},CLD06:{notRun:'deploy_order_pending'}
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
export function tableR5(){
 const used=new Set(Object.values(CASES_R5).flatMap(c=>c.suites??[]));
 return {documentType:'sim-extension-qualification',campaign:false,cases:CASES_R5,gates:GATES_R5,suites:SUITES_R5.filter(s=>used.has(s.id))};
}
export const qualifyR5Structure=input=>qualify(input,tableR5());
export function checkR5Structure(m,read){try{return checkQualification(m,read,tableR5());}catch(e){return ['R5_STRUCTURE_INVALID:'+e.message];}}
export function validateR5Selectors(table,roots){
 for(const suite of table.suites)for(const file of suite.files??[])if(!statSync(join(roots[suite.repo],file),{throwIfNoEntry:false})?.isFile())throw Error('R5_SELECTOR_MISSING:'+suite.id+':'+file);
 for(const suite of table.suites)if(suite.command&&!statSync(join(roots[suite.repo],suite.command[0]),{throwIfNoEntry:false})?.isFile())throw Error('R5_SELECTOR_MISSING:'+suite.id+':'+suite.command[0]);
}
