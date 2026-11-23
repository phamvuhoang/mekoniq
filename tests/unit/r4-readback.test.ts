// V16: the R4 case/gate table and its directory reader. Every refusal first: a missing input is not_run, a corrupt, accepted or other-tuple input is failed, and nothing is read from a status the record claims.
import {afterAll,expect,test} from 'vitest';
import nominalCell from '../fixtures/control/r4-cell-nominal-report.json';
import wheelBench from '../fixtures/control/r4-wheel-bench-report.json';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM script without types
import {CASES_R4,CLOSING_GATES_R4,GATES_R4,SUITES_R4,tableR4,qualifyR4Structure,checkR4Structure} from '../../scripts/sim-extension-r4.mjs';
// @ts-expect-error plain ESM script without types
import {checkCloudRunR4Evidence} from '../../scripts/cloud-run-qualification.mjs';
// @ts-expect-error plain ESM script without types
import {artifactDispositionsFromGroups,verifyOneCampaign,verifyContainerRecord,verifyWebRecord,collectR4ArtifactDispositions,CAMPAIGNS} from '../../scripts/r4-readback.mjs';

const dirs:string[]=[];afterAll(()=>{for(const d of dirs)rmSync(d,{recursive:true,force:true});});
const tmp=()=>{const d=mkdtempSync(join(tmpdir(),'r4-readback-'));dirs.push(d);return d;};
const sha=(b:string)=>createHash('sha256').update(b).digest('hex'),SRC='a'.repeat(40),LAB='b'.repeat(40),PIN={artifactSha256:'c'.repeat(64),schemaHash:'d'.repeat(64),portableToolsDigest:'e'.repeat(64)};
const put=(root:string,file:string,doc:unknown)=>{const text=typeof doc==='string'?doc:JSON.stringify(doc);mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);return {file,sha256:sha(text)};};
const green=(id:string,kind='vitest')=>({id,repo:'source',kind,exitCode:0,result:{file:`suites/${id}/result.json`,sha256:'0'.repeat(64),summary:{passed:3,failed:0,skipped:0,total:3}}});

test('every case is in exactly one gate, every suite a case names exists, and the closing gates leave out G-CAL1',()=>{
 const inGates=Object.values(GATES_R4).flat() as string[];
 expect([...inGates].sort()).toEqual(Object.keys(CASES_R4).sort());expect(new Set(inGates).size).toBe(inGates.length);
 const ids=new Set((SUITES_R4 as {id:string}[]).map(s=>s.id));
 for(const [id,c] of Object.entries(CASES_R4) as [string,{suites?:string[]}][])for(const s of c.suites??[])expect(ids.has(s),`${id}:${s}`).toBe(true);
 expect(CLOSING_GATES_R4).not.toContain('G-CAL1');expect(CLOSING_GATES_R4).toContain('G-CLOUD2');
 expect(Object.keys(tableR4().cases)).toEqual(Object.keys(CASES_R4));
});
test('BEL05 refuses a green suite that omits the study trust-boundary regressions',()=>{
 const suite=SUITES_R4.find((s:{id:string})=>s.id==='bel-engine'),file='tests/unit/pick-rig-review.test.ts';
 expect(CASES_R4.BEL05.suites).toContain(suite.id);
 const result=(files:string[])=>Buffer.from(JSON.stringify({testResults:files.map(name=>({name,status:'passed',assertionResults:[{status:'passed'}]}))}));
 expect(tableR4().checkSuiteResult(suite,result(suite.files.filter((name:string)=>name!==file)))).toContain(`SUITE_FILE_MISSING:bel-engine:${file}`);
 expect(tableR4().checkSuiteResult(suite,result(suite.files))).toEqual([]);
});
test('REC06 and CLD03 are never produced by a suite: not_run with their reason, so G-REC1 and G-CLOUD2 are not tested without them',()=>{
 const d=artifactDispositionsFromGroups({});
 expect(d.REC06.status).toBe('not_run');expect(d.CLD03).toEqual({status:'not_run',issues:['deploy_order_pending']});
 const q=qualifyR4Structure({suites:SUITES_R4.map((s:{id:string;kind:string})=>green(s.id,s.kind)),lab:true,sourceCommit:SRC,artifactDispositions:Object.fromEntries(Object.keys(CASES_R4).map(id=>[id,{status:'tested',issues:[]}]).map(([id,x])=>[id,id==='REC06'||CASES_R4[id as string].notRun?{status:'not_run',issues:['why']}:x]))});
 expect(q.gates['G-REC1'].status).toBe('not_run');expect(q.gates['G-CLOUD2'].status).toBe('not_run');expect(q.gates['G-DRV1'].status).toBe('tested');
});
test('with nothing supplied every case that names an input is not_run (never failed, never tested) and G-CAL1 says why',()=>{
 const d=artifactDispositionsFromGroups(Object.fromEntries(['cilCampaign','benchCampaign','faultCampaign','trayCampaign','perceptionStudy','r2bRecord'].map(k=>[k,['X_MISSING']]).concat([['cld01',['CONTAINER_RECORD_MISSING']],['cld02',['CONTAINER_RECORD_MISSING']],...['WEB07','WEB08','WEB09','WEB10'].map(k=>[k,['WEB_RECORD_MISSING:x']])])));
 for(const id of ['CIL02','TUNE01','FLT01','TRAY01','BEL05','REG05','CLD01','CLD02','WEB07','WEB10','CAL01'])expect(d[id].status,id).toBe('not_run');
 expect(d.DRV01).toEqual({status:'tested',issues:[]}); // suite-only case: the suites decide
});
test('a suite that did not pass fails its case even when its input reads back clean',()=>{
 const q=qualifyR4Structure({suites:SUITES_R4.map((s:{id:string;kind:string})=>s.id==='drv-engine'?{...green(s.id),exitCode:1}:green(s.id,s.kind)),lab:true,sourceCommit:SRC,artifactDispositions:artifactDispositionsFromGroups({})});
 expect(q.cases.DRV08.status).toBe('failed');expect(q.gates['G-DRV1'].status).toBe('failed');
});
const controlSuite=SUITES_R4.find((s:{id:string})=>s.id==='e2e-control');
const playwright=(file:string,status='passed')=>Buffer.from(JSON.stringify({errors:[],stats:{expected:1,unexpected:0,skipped:0,flaky:0},suites:[{file,specs:[{file,id:'id',title:'control',ok:true,tests:[{status:'expected',expectedStatus:'passed',results:[{status,errors:[]}]}]}]}]}));
test('Playwright must execute the selected file and each reported test must pass',()=>{
 const t=tableR4();expect(t.checkSuiteResult(controlSuite,playwright('mujoco-control.spec.ts'))).toEqual([]);
 for(const [file,status] of [['mujoco-calibration.spec.ts','passed'],['mujoco-control.spec.ts','skipped'],['mujoco-control.spec.ts','failed']])
  expect(t.checkSuiteResult(controlSuite,playwright(file!,status))).not.toEqual([]);
 expect(t.checkSuiteResult({id:'x',kind:'vitest',files:['tests/a.test.ts']},Buffer.from('{"stats":{}}')).length).toBeGreaterThan(0);
});
test('a control result and its process must belong to the control suite and match its command',()=>{
 const id=controlSuite.id,result={file:'suites/e2e-calibration/result.json'},process='suites/e2e-control/process.json';
 const r=tableR4().inputs({suites:[{id,repo:'lab',kind:'playwright',exitCode:0,result,process}]},()=>Buffer.from(JSON.stringify({args:['mujoco-calibration.spec.ts'],status:'completed',exitCode:0})));
 expect(r.reasons).toContain('PLAYWRIGHT_RESULT_PATH:e2e-control');expect(r.reasons).toContain('PLAYWRIGHT_PROCESS:e2e-control');
});
test('the result clock falls within the control process that produced it',()=>{
 const p='suites/e2e-control/process.json',file='suites/e2e-control/result.json',su={id:controlSuite.id,repo:'lab',kind:'playwright',exitCode:0,process:p,result:{file}};
 const start='2026-11-22T00:00:00.000Z',finish='2026-11-22T00:00:20.000Z';
 const proc={command:'node',args:controlSuite.command,startedAt:start,finishedAt:finish,status:'completed',exitCode:0,exitSignal:null,writeError:null,spawnError:null};
 const result=JSON.parse(playwright('mujoco-control.spec.ts').toString());Object.assign(result.stats,{startTime:'2026-11-21T00:00:00.000Z',duration:1000});
 const read=(name:string)=>Buffer.from(JSON.stringify(name===p?proc:result));
 expect(tableR4().inputs({suites:[su]},read).reasons).toContain('PLAYWRIGHT_PROCESS:e2e-control');
});
test('a record that says accepted, or has another case/gate table, is refused',()=>{
 const m:Record<string,unknown>={schemaVersion:1,documentType:'sim-extension-qualification',release:'r4',accepted:true,acceptedBy:null,acceptedAt:null,cases:{},gates:{},suites:[]};
 expect(checkR4Structure(m,()=>null)).toContain('ACCEPTED_WITHOUT_REVIEWER');
 expect(tableR4().inputs({...m,accepted:false,acceptedBy:null,acceptedAt:null,lab:{commit:LAB}}).reasons).toEqual(expect.arrayContaining(['CASE_TABLE_MISMATCH','GATE_TABLE_MISMATCH','SUITE_TABLE_MISMATCH']));
 expect(tableR4().inputs({...m,accepted:true}).reasons).toContain('RECORD_ACCEPTED');
});

test('a campaign input: absent is missing, a wrong hash is corrupt, accepted:true, another id or another commit is refused before the verifier runs',async()=>{
 const spec=CAMPAIGNS.cilCampaign,root=tmp();
 expect(await verifyOneCampaign(root,{inputs:{}},'cilCampaign',spec,SRC)).toEqual(['CIL_CAMPAIGN_MISSING']);
 const ref=put(root,'inputs/cil/campaign.json',{campaign:{id:'cil-v2'},sourceCommit:SRC,accepted:false});
 expect(await verifyOneCampaign(root,{inputs:{cilCampaign:{...ref,sha256:'0'.repeat(64)}}},'cilCampaign',spec,SRC)).toEqual(['CIL_CAMPAIGN_CORRUPT']);
 const acc=put(root,'inputs/cil/campaign.json',{campaign:{id:'cil-v2'},sourceCommit:SRC,accepted:true});
 expect(await verifyOneCampaign(root,{inputs:{cilCampaign:acc}},'cilCampaign',spec,SRC)).toContain('CIL_CAMPAIGN_ACCEPTED');
 const other=put(root,'inputs/cil/campaign.json',{campaign:{id:'fault-v1'},sourceCommit:'e'.repeat(40),accepted:false});
 expect(await verifyOneCampaign(root,{inputs:{cilCampaign:other}},'cilCampaign',spec,SRC)).toEqual(expect.arrayContaining(['CIL_CAMPAIGN_ID_MISMATCH','CIL_CAMPAIGN_TUPLE_MISMATCH']));
});
test('a campaign with no run directories is incomplete (not_run), never a pass',async()=>{
 const root=tmp(),ref=put(root,'inputs/cil/campaign.json',{campaign:{id:'cil-v2'},sourceCommit:SRC,accepted:false});
 const r=await verifyOneCampaign(root,{inputs:{cilCampaign:ref}},'cilCampaign',CAMPAIGNS.cilCampaign,SRC);
 expect(r.length).toBeGreaterThan(0);expect(r.some((x:string)=>/_INCOMPLETE$|_READER:/.test(x))).toBe(true);
});

const titles=["CLD01: MJ-CELL-BV01 on drive-nominal-v1 completes and serves 2, a scheduled drive fault reports its receipts, the three-cup tray serves 3, and a wheel bench step completes and frees the slot, inside the image; read-only root, empty diff, not root, ports on 127.0.0.1 only", "CLD01 (R4.4): MJ-CELL-BV01 at belief_estimated with the nominal perception profile and the recovery policy completes and serves 2 inside the image, its report carries the perception evidence, and a belief mode on the arm-only scenario is refused"];
const imageId='sha256:'+'1'.repeat(64);
const cld01Result=(file='tests/integration/lab-runtime-container-r4.test.ts',tests=titles)=>({
 success:true,numPendingTests:0,numTodoTests:0,numFailedTests:0,numTotalTests:tests.length,numPassedTests:tests.length,
 testResults:[{name:file,status:'passed',assertionResults:tests.map(title=>({title,status:'passed'}))}]});
const container=(result=cld01Result(),id=imageId)=>{
 const root=tmp(),r=put(root,'inputs/container/cld01.json',result),image='mekoniq-lab-runtime:r4-'+SRC.slice(0,8);
 const identity={image,imageId,sourceCommit:SRC,platform:'linux/arm64',host:{os:'Darwin',machine:'arm64',daemonPlatform:'linux/arm64'},...PIN};
 put(root,'inputs/container/cld01-test.log',[1,2].map(()=>'CLD01 identity '+JSON.stringify(identity)).join('\n'));
 const counts=put(root,'inputs/container/cld02.json',{tests:316,failures:0,errors:0,skipped:0});
 const rec={schemaVersion:1,accepted:false,sourceCommit:SRC,cld01:{status:'tested',platform:'linux/arm64',imageTag:image,imageId:id,sourceCommit:SRC,result:{file:'cld01.json',sha256:r.sha256}},cld02:{status:'tested',platform:'linux/amd64',imageId,sourceCommit:SRC,result:{file:'cld02.json',sha256:counts.sha256}}};
 const ref=put(root,'inputs/container/container.json',rec);return {root,m:{lab:{pin:PIN},inputs:{containerRecord:ref}},rec};};
test('CLD01 binds both container assertions and recorded runtime/image identity',async()=>{
 for(const [entry,valid] of [[container(),true],[container(cld01Result('tests/unit/drive-io.test.ts')),false],[container(cld01Result(undefined,titles.slice(0,1))),false],[container(cld01Result(),'sha256:'+'3'.repeat(64)),false]] as const){
  expect((await verifyContainerRecord(entry.root,entry.m,SRC)).cld01.length===0).toBe(valid);
 }
});
test('CLD02 refuses a count-only import even with green totals and a current wrapper',async()=>{
 const c=container();expect((await verifyContainerRecord(c.root,c.m,SRC)).cld02).not.toEqual([]);
});
const PANELS:Record<string,string>={control:'e2e-control',faults:'e2e-faults',tray:'e2e-tray',belief:'e2e-belief',calibration:'e2e-calibration','fault-composer':'e2e-faults','perception-study':'e2e-belief',recovery:'e2e-belief'};
const TARGETS:Record<string,string[]>={control:['control-bench'],faults:['fault-evidence'],tray:['tray-hint'],belief:['belief-legend'],calibration:['calibration-record','calibration-fitted','calibration-residuals','calibration-domain','calibration-plot'],'fault-composer':['drive-faults','fault-timeline'],'perception-study':['perception-study','perception-study-rows'],recovery:['perception-recovery']};
const web=(o:{drop?:string;row?:Record<string,unknown>;samples?:string[];manifest?:Record<string,unknown>;catalog?:Record<string,unknown>}={})=>{
 const root=tmp();
 for(const [panel,suite] of Object.entries(PANELS)){
  const base=`suites/${suite}/screens/`,files=Object.entries({'index.html':'<script type="module" src="/assets/main.js"></script>','source-runtime.lock.json':JSON.stringify({sourceCommit:SRC,...PIN,dirty:false}),'assets/main.js':'document.body.textContent="production fixture";'}).map(([path,bytes])=>{const ref=put(root,base+'production-ui/'+path,bytes);return {path,sha256:ref.sha256,bytes:Buffer.byteLength(bytes)};});
  const receipt=put(root,base+'production-ui.json',{schemaVersion:1,kind:'lab-production-ui',labCommit:LAB,labDirty:false,sourceCommit:SRC,runtimeArtifact:PIN.artifactSha256,schemaHash:PIN.schemaHash,files});
  if(panel===o.drop&&!o.row)continue;
  for(const state of panel==='calibration'?['populated','empty','error']:['populated']){
   const rows=['vi','ja','en'].flatMap(lang=>[390,1024,1440].map(width=>({panel,lang,width,axeSeriousCritical:0,axeIds:[],reducedMotion:true,horizontalScroll:false,populated:state==='populated',productionSha256:receipt.sha256,...panel===o.drop&&lang==='ja'&&width===390?o.row:{}})));
   const requiredTestIds=state==='populated'?TARGETS[panel]!:[`calibration-${state}`];
   put(root,base+`web07-${panel}${state==='populated'?'':'-'+state}.json`,{schemaVersion:1,panel,state,testId:requiredTestIds[0],requiredTestIds,productionSha256:receipt.sha256,rows});
  }
 }
 const ids=o.samples??['drive-fault','belief-recovery'],replays=ids.map(id=>{const man={runId:'run-'+id,provenance:{calibration:'not_calibrated',accepted:false},...o.manifest};const ref=put(root,`inputs/web/replays/${id}/manifest.json`,man);return {id,manifestSha256:ref.sha256,recording:'run-'+id,provenance:'R4 harness recording; display only; accepted:false; not_calibrated',...o.catalog};});
 const ref=put(root,'inputs/web/replays/catalog.json',{schemaVersion:1,replays});return {root,m:{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:{sourceCommit:SRC,...PIN}},inputs:{webSamples:ref}}};};
test('web record: WEB07 rows come from the real-run specs (5 panels × 3 languages × 3 widths, axe 0, reduced motion, no scroll); WEB10 samples hash to the catalog, say not_calibrated and accepted:false; WEB09 is not measured yet',async()=>{
 const a=web(),ra=await verifyWebRecord(a.root,a.m);expect(ra.WEB07).toEqual([]);expect(ra.WEB08.length).toBeGreaterThan(0);expect(ra.WEB10).toContain('WEB10_SAMPLE_FAILED:belief-recovery');expect(ra.WEB09[0]).toMatch(/^WEB09_MEASUREMENT_MISSING/);
 const b=web({drop:'tray'});expect((await verifyWebRecord(b.root,b.m)).WEB07).toEqual(['WEB07_ROWS_MISSING:tray']);
 const c=web({drop:'faults',row:{axeSeriousCritical:2}});expect((await verifyWebRecord(c.root,c.m)).WEB07).toEqual(['WEB07_CELL_FAILED:faults/ja/390']);
 const d=web({drop:'faults',row:{horizontalScroll:true}});expect((await verifyWebRecord(d.root,d.m)).WEB07).toEqual(['WEB07_CELL_FAILED:faults/ja/390']);
 const e=web({drop:'belief',row:{reducedMotion:false}});expect((await verifyWebRecord(e.root,e.m)).WEB07).toEqual(['WEB07_CELL_FAILED:belief/ja/390']);
 const f=web({samples:['drive-fault']}),rf=await verifyWebRecord(f.root,f.m);expect(rf.WEB10).toContain('WEB10_SAMPLE_MISSING:belief-recovery');expect(rf.WEB08.length).toBeGreaterThan(0);
 const i=web({samples:['drive-fault']});i.m.inputs.webSamples={...i.m.inputs.webSamples,sha256:'0'.repeat(64)};expect((await verifyWebRecord(i.root,i.m)).WEB10).toEqual(['WEB_RECORD_CORRUPT']);
 const j=web();expect((await verifyWebRecord(j.root,{inputs:{}})).WEB10).toEqual(['WEB_RECORD_MISSING:replay samples']);
});
test('WEB07 refuses measurements without a production build or with only the calibration badge',async()=>{
 const a=web();rmSync(join(a.root,'suites/e2e-control/screens/production-ui.json'),{force:true});
 expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_PRODUCTION_MISSING:control');
 const b=web(),path='suites/e2e-calibration/screens/web07-calibration.json',rows=JSON.parse(readFileSync(join(b.root,path),'utf8'));
 put(b.root,path,{...rows,testId:'control-model-maturity',requiredTestIds:['control-model-maturity']});
 expect((await verifyWebRecord(b.root,b.m)).WEB07).toContain('WEB07_TARGET_INVALID:calibration');
});
test('the five runtime WEB07 suites explicitly select production UI',()=>{
 for(const id of Object.values(PANELS))expect(SUITES_R4.find((s:{id:string})=>s.id===id).command).toContain('--production-ui');
});
test('WEB07 binds a clean production build to both commits, the runtime pin and the stored asset bytes',async()=>{
 for(const changed of [{labCommit:'e'.repeat(40)},{sourceCommit:'e'.repeat(40)},{labDirty:true},{runtimeArtifact:'e'.repeat(64)}]){
  const a=web(),path='suites/e2e-control/screens/production-ui.json',doc=JSON.parse(readFileSync(join(a.root,path),'utf8'));put(a.root,path,{...doc,...changed});
  expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_PRODUCTION_INVALID:control');
 }
 const a=web();put(a.root,'suites/e2e-control/screens/production-ui/assets/main.js','substituted');
 expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_PRODUCTION_INVALID:control');
 const b=web(),base='suites/e2e-control/screens/',path=base+'production-ui.json',doc=JSON.parse(readFileSync(join(b.root,path),'utf8'));
 const index='<script src="/@vite/client"></script><script src="/assets/main.js"></script>',ref=put(b.root,base+'production-ui/index.html',index);
 doc.files=doc.files.map((f:{path:string})=>f.path==='index.html'?{path:f.path,sha256:ref.sha256,bytes:Buffer.byteLength(index)}:f);put(b.root,path,doc);
 expect((await verifyWebRecord(b.root,b.m)).WEB07).toContain('WEB07_PRODUCTION_INVALID:control');
});
test('WEB07 keeps populated, empty and error calibration sweeps separate, and refuses rows from another build',async()=>{
 const a=web();rmSync(join(a.root,'suites/e2e-calibration/screens/web07-calibration-empty.json'));
 expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_ROWS_MISSING:calibration-empty');
 for(const change of [{populated:false},{productionSha256:'f'.repeat(64)}]){
  const b=web({drop:'control',row:change});expect((await verifyWebRecord(b.root,b.m)).WEB07).toContain('WEB07_CELL_FAILED:control/ja/390');
 }
});
test('WEB07 cannot omit the study, recovery list or fault composer from its panel coverage',async()=>{
 for(const [panel,suite] of [['perception-study','e2e-belief'],['recovery','e2e-belief'],['fault-composer','e2e-faults']]){
  const a=web();rmSync(join(a.root,`suites/${suite}/screens/web07-${panel}.json`),{force:true});
  expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_ROWS_MISSING:'+panel);
 }
});
test('WEB07 refuses resealed builds missing a dynamic app chunk or carrying another portable tool pin',async()=>{
 for(const [path,text] of [['assets/main.js','import("./missing-app.js");'],['source-runtime.lock.json',JSON.stringify({sourceCommit:SRC,...PIN,portableToolsDigest:'f'.repeat(64),dirty:false})]]){
  const a=web(),base='suites/e2e-control/screens/',doc=JSON.parse(readFileSync(join(a.root,base+'production-ui.json'),'utf8')),ref=put(a.root,base+'production-ui/'+path,text);
  doc.files=doc.files.map((f:{path:string})=>f.path===path?{path,sha256:ref.sha256,bytes:Buffer.byteLength(text!)}:f);
  const receipt=put(a.root,base+'production-ui.json',doc),rowPath=base+'web07-control.json',rows=JSON.parse(readFileSync(join(a.root,rowPath),'utf8'));
  put(a.root,rowPath,{...rows,productionSha256:receipt.sha256,rows:rows.rows.map((r:Record<string,unknown>)=>({...r,productionSha256:receipt.sha256}))});
  expect((await verifyWebRecord(a.root,a.m)).WEB07).toContain('WEB07_PRODUCTION_INVALID:control');
 }
});

test('REG05: no R2b record or mock regression is missing; an R2b record of another commit, or a mock regression of another commit, fails',async()=>{
 const root=tmp();let d=await collectR4ArtifactDispositions(root,{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:PIN},inputs:{}});
 expect(d.artifactDispositions.REG05.status).toBe('not_run');
 const r2b=put(root,'inputs/r2b/qualification.json',{release:'r2b',accepted:false,identity:{before:{sourceCommit:'e'.repeat(40)}},lab:{commit:LAB,pin:PIN},gates:{}});
 const mock=put(root,'inputs/mock/manifest.json',{schema:'lab-v2-regression/1',identity:{start:{source:{commit:'e'.repeat(40)}}},commands:[{exitCode:0}]});
 d=await collectR4ArtifactDispositions(root,{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:PIN},inputs:{r2bRecord:r2b,mockRegression:mock}});
 expect(d.artifactDispositions.REG05.status).toBe('failed');expect(d.issues).toEqual(expect.arrayContaining(['R2B_TUPLE_MISMATCH','MOCK_REGRESSION_NOT_GREEN']));
});

test('REG05 verifies both identities, executed regressions and the nested R2a mock bytes',async()=>{
 const root=tmp(),identity={source:{commit:SRC,codeHash:'1'.repeat(64),dirtyCodePaths:[]},lab:{commit:LAB,codeHash:'2'.repeat(64),dirtyCodePaths:[]}};
 const mock={schema:'lab-v2-regression/1',identity:{start:identity,end:identity},commands:[{id:'lab-mock-e2e',exitCode:0}],notRun:[]};
 const nested=put(root,'inputs/r2b/inputs/r2a/mock-regression.json',mock);
 put(root,'inputs/r2b/inputs/r2a/qualification.json',{mockRegression:{file:'mock-regression.json',sha256:nested.sha256,labCommit:LAB}});
 for(const [doc,reason] of [[{...mock,extra:'different bytes'},'MOCK_REGRESSION_CHAIN_MISMATCH'],[{...mock,identity:{start:identity,end:{...identity,lab:{...identity.lab,commit:SRC}}}},'MOCK_REGRESSION_NOT_GREEN'],[{...mock,notRun:['skipped']},'MOCK_REGRESSION_NOT_GREEN']] as const){
  const ref=put(root,'inputs/mock/manifest.json',doc);
  const result=await collectR4ArtifactDispositions(root,{identity:{before:{sourceCommit:SRC}},lab:{commit:LAB,pin:PIN},inputs:{mockRegression:ref}});
  expect(result.artifactDispositions.REG05.issues).toContain(reason);
 }
});
test('the recorder lists its closed suites with --plan and refuses to run without its required inputs (exit 2)',()=>{
 const p=spawnSync(process.execPath,['scripts/record-sim-extension-r4.mjs','--plan'],{encoding:'utf8',timeout:20000});expect(p.status,p.stderr).toBe(0);
 expect(p.stdout).toContain('drv-engine');expect(p.stdout).toContain('deploy_order_pending');
 const missing=spawnSync(process.execPath,['scripts/record-sim-extension-r4.mjs','--out','/tmp/unused-r4-output'],{encoding:'utf8',timeout:20000});expect(missing.status).toBe(2);expect(missing.stderr).toContain('MISSING_OPTION');
});

// Real Mac report shapes; cloud fixtures explicitly substitute x86_64 and a distinct run ID. These are reader tests, never native/cloud evidence.
const cloud=(patch:Record<string,unknown>={},sumPatch:Record<string,unknown>={},reports:Record<string,unknown>={})=>{
 const q=JSON.stringify({release:'r4',accepted:false,candidateId:'r4-candidate-01',identity:{identityStable:true,before:{sourceCommit:nominalCell.manifest.sourceCommit}},lab:{pin:{sourceCommit:nominalCell.manifest.sourceCommit,...PIN}},cases:{CLD03:{status:'not_run'}},gates:{'G-CLOUD2':{status:'not_run'}}});
 const f:Record<string,unknown>={
  'deployment.json':{schema:'mekoniq-cloud-run-deployment/2',accepted:false,sourceCommit:nominalCell.manifest.sourceCommit,artifactSha256:PIN.artifactSha256,qualification:{sha256:sha(q),candidateId:'r4-candidate-01'},url:'https://x-abc-as.a.run.app/',platform:'linux/amd64',image:'img@sha256:'+'1'.repeat(64),revision:'rev-1',traffic:[{revisionName:'rev-1',percent:100}],...patch},
  'health.json':{sourceCommit:nominalCell.manifest.sourceCommit,schemaHash:PIN.schemaHash},'cell-report.json':{...nominalCell,schemaHash:PIN.schemaHash,manifest:{...nominalCell.manifest,runId:'synthetic-cloud-cell',drive:{...nominalCell.manifest.drive,hostArch:'x86_64'}}},
  'bench-report.json':{...wheelBench,schemaHash:PIN.schemaHash,tuning:{...wheelBench.tuning,engine:{...wheelBench.tuning.engine,hostArch:'x86_64'}}},
  'mac-cell-report.json':nominalCell,
  'summary.json':{schema:'mekoniq-cloud-run-r4-smoke/1',accepted:false,expectedCommit:nominalCell.manifest.sourceCommit,service:'https://x-abc-as.a.run.app/',status:'tested',cases:{health:'tested',cell:'tested',bench:'tested'},timing:{cellMsPerTick:30,benchMsPerTick:12,realtimeFactor:2/3,cellTicks:nominalCell.outcome.tick,benchTicks:wheelBench.outcome.tick},macComparison:{servedMac:'2',servedCloud:'2'},...sumPatch}};
 Object.assign(f,reports);const bytes:Record<string,string>={};for(const [k,v] of Object.entries(f))bytes[k]=JSON.stringify(v);
 bytes['checksums.json']=JSON.stringify({algorithm:'sha256',files:Object.fromEntries(Object.entries(bytes).map(([k,v])=>[k,sha(v)]))});
 return (p:string)=>bytes[p]===undefined?null:Buffer.from(bytes[p]);
};
test('CLD03: the supplement binds to the exact R4 record bytes; a wrong commit, a served count other than 2, a missing timing, accepted:true or a record that already has CLD03 tested is refused',()=>{
 const rec=JSON.stringify({release:'r4',accepted:false,candidateId:'r4-candidate-01',identity:{identityStable:true,before:{sourceCommit:nominalCell.manifest.sourceCommit}},lab:{pin:{sourceCommit:nominalCell.manifest.sourceCommit,...PIN}},cases:{CLD03:{status:'not_run'}},gates:{'G-CLOUD2':{status:'not_run'}}});
 expect(checkCloudRunR4Evidence(cloud(),rec)).toEqual([]);
 expect(checkCloudRunR4Evidence(cloud(),rec.replace('r4-candidate-01','r4-candidate-02'))).toContain('R4_HASH_MISMATCH');
 expect(checkCloudRunR4Evidence(cloud({sourceCommit:'e'.repeat(40)}),rec)).toContain('IDENTITY_MISMATCH');
 expect(checkCloudRunR4Evidence(cloud({accepted:true}),rec)).toContain('ACCEPTANCE_FORBIDDEN');
 expect(checkCloudRunR4Evidence(cloud({},{timing:{cellMsPerTick:30,benchMsPerTick:12,realtimeFactor:0,cellTicks:10900}}),rec)).toContain('TIMING_MISSING');
 expect(checkCloudRunR4Evidence(cloud({},{macComparison:{servedMac:'2',servedCloud:'1'}}),rec)).toContain('MAC_COMPARISON_MISSING_OR_DIFFERENT');
 expect(checkCloudRunR4Evidence(cloud({url:'http://localhost/'}),rec)).toContain('DEPLOYMENT_MISMATCH');
});
test('CLD03 refuses Mac reports presented as Cloud, a cell presented as a bench, and summary facts that contradict the reports',()=>{
 const rec=JSON.stringify({release:'r4',accepted:false,candidateId:'r4-candidate-01',identity:{identityStable:true,before:{sourceCommit:nominalCell.manifest.sourceCommit}},lab:{pin:{sourceCommit:nominalCell.manifest.sourceCommit,...PIN}},cases:{CLD03:{status:'not_run'}},gates:{'G-CLOUD2':{status:'not_run'}}});
 expect(checkCloudRunR4Evidence(cloud({},{},{'cell-report.json':{...nominalCell,schemaHash:PIN.schemaHash}}),rec)).toContain('CLOUD_ARCH_MISMATCH');
 expect(checkCloudRunR4Evidence(cloud({},{},{'bench-report.json':{...nominalCell,schemaHash:PIN.schemaHash}}),rec)).toContain('BENCH_NOT_COMPLETED');
 expect(checkCloudRunR4Evidence(cloud({},{macComparison:{servedMac:'1',servedCloud:'1'}}),rec)).toContain('MAC_COMPARISON_MISSING_OR_DIFFERENT');
 expect(checkCloudRunR4Evidence(cloud({},{timing:{cellMsPerTick:30,benchMsPerTick:12,realtimeFactor:2/3,cellTicks:1,benchTicks:500}}),rec)).toContain('TIMING_MISSING');
});

test('cloud-run acceptance selects the R4 directory reader for an R4 qualification',()=>{
 const root=tmp();put(root,'qualification.json',{schemaVersion:1,documentType:'sim-extension-qualification',release:'r4',suites:[],gates:{},cases:{}});
 const p=spawnSync(process.execPath,['scripts/test-runner.mjs','acceptance','cloud-run'],{encoding:'utf8',env:{...process.env,LAB_SIMEXT_EVIDENCE_DIR:root,LAB_CLOUD_EVIDENCE_DIR:root},timeout:30000});
 expect(p.status).toBe(1);expect(p.stdout+p.stderr).toContain('ARTIFACT_DISPOSITION_MISMATCH');
});

test.each([['bel-unit','tests/unit/belief-integrity.test.ts'],['r4-regression','tests/unit/r4-web09-readback.test.ts']])('R4 requires %s to execute %s', (id,file)=>{
 const suite=SUITES_R4.find((s:{id:string})=>s.id===id);expect(suite.files).toContain(file);
 const result=(files:string[])=>Buffer.from(JSON.stringify({testResults:files.map(name=>({name,status:'passed',assertionResults:[{status:'passed'}]}))}));
 expect(tableR4().checkSuiteResult(suite,result(suite.files.filter((name:string)=>name!==file)))).toContain(`SUITE_FILE_MISSING:${id}:${file}`);
 expect(tableR4().checkSuiteResult(suite,result(suite.files))).toEqual([]);
});
test('an omitted REC06 recording leaves independently executed REC01–05 tested',()=>{
 const suites=SUITES_R4.map((s:{id:string;kind:string;files?:string[]})=>{
  const result=green(s.id,s.kind);
  if(s.files?.includes('tests/integration/recovery-cell-recorded.test.ts'))result.result.summary={passed:0,failed:0,skipped:2,total:2};
  return result;
 });
 const q=qualifyR4Structure({suites,sourceCommit:SRC,lab:true,artifactDispositions:artifactDispositionsFromGroups({recoveryCampaign:['RECOVERY_CAMPAIGN_MISSING']})});
 expect(['REC01','REC02','REC03','REC04','REC05'].map(id=>q.cases[id].status)).toEqual(Array(5).fill('tested'));
 expect(q.cases.REC06.status).toBe('not_run');
});
