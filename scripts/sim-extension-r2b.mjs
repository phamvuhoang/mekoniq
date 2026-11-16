// R2b structural table uses the immutable qualification core. Public success also requires directory readback.
import {statSync} from 'node:fs';
import {join} from 'node:path';
import {qualify,checkQualification} from './irsim-qualification.mjs';
const V=(id,files,repo='source')=>({id,repo,kind:'vitest',files});
export const SUITES_R2B=[
 V('mj-contracts',['tests/contracts/mujoco-payload.test.ts','tests/unit/payload-fixture.test.ts','tests/unit/payload-experiments.test.ts']),
 V('mj-worker',['tests/integration/mujoco-mobile-worker.test.ts','tests/integration/mujoco-mobile-lifecycle.test.ts','tests/integration/mujoco-mobile-readiness.test.ts']),
 V('mj-evidence',['tests/integration/mujoco-payload-campaign.test.ts','tests/integration/physics-evidence.test.ts']),
 V('cell-contracts',['tests/unit/world-scene.test.ts','tests/unit/world-control.test.ts','tests/unit/world-handoff-policy.test.ts','tests/unit/world-sweep.test.ts','tests/security/mujoco-world-authority.test.ts']),
 V('cell-runtime',['tests/integration/mujoco-world-rig.test.ts','tests/integration/mujoco-cell-readiness.test.ts']),
 V('web-evidence',['tests/unit/web-replay-reader.test.ts','tests/unit/web-replay-capture.test.ts','tests/security/web-replay-export.test.ts','tests/security/web-replay-gateway.test.ts']),
 V('web-ui',['tests/unit/world-view.test.ts','tests/unit/replay-transport.test.ts','tests/unit/workspace-replay-freshness.test.ts'],'lab'),
 V('web-container',['tests/integration/lab-runtime-container.test.ts']),
 V('semantic',['tests/unit/semantic-study.test.ts']),
 V('r2b-regression',['tests/security/payload.test.ts','tests/unit/bv01-mock-golden.test.ts','tests/integration/portable-tool-closure.test.ts','tests/integration/lab-runtime-artifact.test.ts','tests/unit/sim-extension-qualification.test.ts'])
];
const cases=(ids,suites)=>Object.fromEntries(ids.map(id=>[id,{suites}]));
const HOST_REASON='blocked_external: no assigned HTTPS host; WEB06 requires its own current-tuple deployment evidence';
export const CASES_R2B={...cases(['MJ01','MJ02','MJ03','MJ04','MJ05','MJ06','MJ07'],['mj-contracts','mj-worker','mj-evidence']),...cases(['CELL01','CELL02','CELL03','CELL04','CELL05','CELL06'],['cell-contracts','cell-runtime']),...cases(['WEB01','WEB02','WEB03','WEB04'],['web-evidence','web-ui']),WEB05:{suites:['web-container']},WEB06:{notRun:HOST_REASON},X01:{suites:['semantic']},REG04:{suites:['r2b-regression']}};
export const GATES_R2B={'G-MJ1':['MJ01','MJ02','MJ03','MJ04','MJ05','MJ06','MJ07'],'G-CELL1':['CELL01','CELL02','CELL03','CELL04','CELL05','CELL06'],'G-WEB1':['WEB01','WEB02','WEB03','WEB04','WEB05'],'G-X1':['X01'],'G-REG4':['REG04'],'G-HOST1':['WEB06']};
const equalKeys=(a,b)=>JSON.stringify(Object.keys(a??{}).sort())===JSON.stringify(Object.keys(b).sort());
export function tableR2b(scope='full'){
 if(!['full','mobility'].includes(scope))throw Error('R2B_SCOPE_INVALID');
 const gates=scope==='full'?GATES_R2B:{'G-MJ1':GATES_R2B['G-MJ1'],'G-REG4':['REG04']},ids=new Set(Object.values(gates).flat()),tableCases=Object.fromEntries(Object.entries(CASES_R2B).filter(([id])=>ids.has(id))),used=new Set(Object.values(tableCases).flatMap(c=>c.suites??[]));
 return {documentType:'sim-extension-qualification',campaign:false,checkSuiteResult:checkR2bExecutedFiles,cases:tableCases,gates,suites:SUITES_R2B.filter(s=>used.has(s.id)),inputs(m){const reasons=[];
  if(m.accepted!==false||m.acceptedBy!==null||m.acceptedAt!==null)reasons.push('RECORD_ACCEPTED');
  if(!equalKeys(m.cases,tableCases))reasons.push('CASE_TABLE_MISMATCH');
  if(!equalKeys(m.gates,gates))reasons.push('GATE_TABLE_MISMATCH');
  const actual=m.suites??[];if(actual.length!==used.size||new Set(actual.map(s=>s.id)).size!==actual.length||actual.some(s=>!used.has(s.id)))reasons.push('SUITE_TABLE_MISMATCH');
  if(!/^[a-f0-9]{40}$/.test(m.lab?.commit??''))reasons.push('LAB_COMMIT_REQUIRED');
  if(m.blocked||m.cl01||m.web06)reasons.push('R2B_UNSUPPORTED_OVERRIDE');
  if(!equalKeys(m.artifactDispositions,tableCases)||Object.values(m.artifactDispositions??{}).some(x=>!['tested','not_run','failed','blocked_external'].includes(x?.status)||!Array.isArray(x?.issues)))reasons.push('ARTIFACT_DISPOSITION_SHAPE');
  return {input:{artifactDispositions:m.artifactDispositions},reasons};},adjust(q,input){
   for(const [id,c]of Object.entries(q.cases)){if(id==='WEB06')continue;const d=input.artifactDispositions?.[id]??{status:'not_run',issues:['ARTIFACT_READBACK_PENDING']};
    const absentContainer=id==='WEB05'&&input.suites?.find(s=>s.id==='web-container'&&s.reason==='IMAGE_UNBUILT'&&!s.result&&!s.process&&s.exitCode===2);
    if(d.status==='failed'||d.status==='not_run'&&(c.status!=='failed'||absentContainer)){c.status=d.status;c.reason='artifact '+d.status+': '+d.issues.join('; ');}else if(c.status==='tested')c.evidence.push('artifact:'+id);
   }
   q.notRun=Object.entries(q.cases).filter(([,c])=>c.status!=='tested').map(([id,c])=>({id,reason:c.reason}));for(const [id,g]of Object.entries(q.gates))g.status=id==='G-HOST1'?'blocked_external':g.cases.every(id=>q.cases[id].status==='tested')?'tested':'not_run';return q;
  }};
}
export const qualifyR2bStructure=input=>qualify(input,tableR2b(input.scope));
export function checkR2bStructure(m,read){try{return checkQualification(m,read,tableR2b(m.scope));}catch(e){return ['R2B_STRUCTURE_INVALID:'+e.message];}}

/** Closed selectors must name real files before any campaign copy or expensive execution. */
export function validateR2bSelectors(table,roots){
 for(const suite of table.suites)for(const file of suite.files)if(!statSync(join(roots[suite.repo],file),{throwIfNoEntry:false})?.isFile())throw Error('R2B_SELECTOR_MISSING:'+suite.id+':'+file);
}
/** Portable file identity: exact tests-relative path, never basename/filter matching.
 * Absolute Vitest names may have any checkout prefix, but must share one cwd. */
export function checkR2bExecutedFiles(suite,bytes){
 const issues=[],fail=(code,file='')=>issues.push(`SUITE_FILE_${code}:${suite.id}${file?':'+file:''}`);let data;
 try{data=JSON.parse(bytes.toString('utf8'));}catch{fail('RESULT_INVALID');return issues;}
 if(!Array.isArray(data.testResults)){fail('RESULT_INVALID');return issues;}
 const seen=new Set(),roots=new Set();
 for(const row of data.testResults){
  const name=typeof row.name==='string'?row.name.replaceAll('\\','/'):'',parts=name.split('/');
  const at=parts.indexOf('tests'),file=at>=0?parts.slice(at).join('/'):'';
  if(at<0||parts.lastIndexOf('tests')!==at||parts.includes('..')||!file||at>0&&!name.startsWith('/')&&!/^[A-Za-z]:\//.test(name)&&!name.startsWith('./')){fail('IDENTITY');continue;}
  roots.add(parts.slice(0,at).join('/'));if(seen.has(file))fail('DUPLICATE',file);seen.add(file);
  if(!suite.files.includes(file)){fail('UNEXPECTED',file);continue;}
  const assertions=row.assertionResults;
  if(row.status==='failed'||row.message||Array.isArray(assertions)&&assertions.some(a=>a.status==='failed'))fail('FAILED',file);
  else if(row.status!=='passed'||!Array.isArray(assertions)||!assertions.length||assertions.some(a=>a.status!=='passed'))fail('SKIPPED',file);
 }
 if(roots.size>1)fail('AMBIGUOUS_ROOT');for(const file of suite.files)if(!seen.has(file))fail('MISSING',file);return issues;
}
