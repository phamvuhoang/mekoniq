import {expect,test} from 'vitest';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {createHash} from 'node:crypto';
// @ts-expect-error standalone tooling
import {SUITES_R2B,validateR2bSelectors} from '../../scripts/sim-extension-r2b.mjs';
// @ts-expect-error standalone tooling
import {verifyR2bDirectory,evidenceInventory} from '../../scripts/r2b-readback.mjs';
// @ts-expect-error standalone tooling
import {summarizeResult} from '../../scripts/irsim-qualification.mjs';
test('every closed R2b selector exists and cloud payload remains required only in regression',()=>{
 expect(()=>validateR2bSelectors({suites:SUITES_R2B},{source:resolve('.'),lab:resolve('../lab')})).not.toThrow();
 expect(()=>validateR2bSelectors({suites:SUITES_R2B},{source:resolve('missing-checkout'),lab:resolve('../lab')})).toThrow('R2B_SELECTOR_MISSING');
 for(const suite of SUITES_R2B)for(const file of suite.files)expect(existsSync(resolve(suite.repo==='lab'?'../lab':'.',file)),`${suite.id}:${file}`).toBe(true);
 expect(SUITES_R2B.find((s:{id:string})=>s.id==='mj-evidence').files).toEqual(['tests/integration/mujoco-payload-campaign.test.ts','tests/integration/physics-evidence.test.ts']);
 expect(SUITES_R2B.find((s:{id:string})=>s.id==='r2b-regression').files).toContain('tests/security/payload.test.ts');
});
const required=['tests/integration/mujoco-payload-campaign.test.ts','tests/integration/physics-evidence.test.ts'];
const rows=()=>required.map(name=>({name:'/portable/source/'+name,status:'passed',message:'',assertionResults:[{status:'passed',title:'executed'}]}));
async function readCoverage(files:ReturnType<typeof rows>){
 const root=mkdtempSync(join(tmpdir(),'r2b-membership-'));try{
  const result={numPassedTests:files.flatMap(f=>f.assertionResults).filter(a=>a.status==='passed').length,numFailedTests:files.flatMap(f=>f.assertionResults).filter(a=>a.status==='failed').length,numPendingTests:files.flatMap(f=>f.assertionResults).filter(a=>a.status==='pending').length,numTotalTests:files.flatMap(f=>f.assertionResults).length,success:files.every(f=>f.status==='passed'),testResults:files};
  const bytes=Buffer.from(JSON.stringify(result)),file='suites/mj-evidence/result.json',path=join(root,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
  const manifest={release:'r2b',scope:'full',schemaVersion:1,documentType:'sim-extension-qualification',accepted:false,acceptedBy:null,acceptedAt:null,suites:[{id:'mj-evidence',repo:'source',kind:'vitest',exitCode:result.success?0:1,result:{file,sha256:createHash('sha256').update(bytes).digest('hex'),summary:summarizeResult('vitest',bytes.toString())}}],artifacts:evidenceInventory(root)};
  writeFileSync(join(root,'qualification.json'),JSON.stringify(manifest));const issues:string[]=await verifyR2bDirectory(root);
  expect(issues.some(s=>/ARTIFACT_(INVENTORY_MISMATCH|CORRUPT)|SUITE_RESULT_CORRUPT|SUITE_SUMMARY_MISMATCH/.test(s))).toBe(false);
  return issues.filter(s=>s.startsWith('SUITE_FILE_'));
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('public reader admits complete executed file identities in absolute and relative cwd layouts',async()=>{expect(await readCoverage(rows())).toEqual([]);const relative=rows();for(const f of relative)f.name=f.name.replace('/portable/source/','');expect(await readCoverage(relative)).toEqual([]);});
test('public reader rejects coherently rehashed missing and substituted file coverage',async()=>{
 expect(await readCoverage(rows().slice(0,1))).toContain('SUITE_FILE_MISSING:mj-evidence:'+required[1]);
 const substituted=rows();substituted[1]!.name='/portable/source/tests/unit/unrelated.test.ts';expect(await readCoverage(substituted)).toContain('SUITE_FILE_MISSING:mj-evidence:'+required[1]);
});
test('public reader rejects duplicate identities, failed setup and skipped per-file execution',async()=>{
 const duplicate=rows();duplicate.push({...duplicate[1]!});expect(await readCoverage(duplicate)).toContain('SUITE_FILE_DUPLICATE:mj-evidence:'+required[1]);
 const failed=rows();failed[1]!.status='failed';failed[1]!.message='OWNED_TEST_SERVICE_REQUIRED';failed[1]!.assertionResults[0]!.status='pending';expect(await readCoverage(failed)).toContain('SUITE_FILE_FAILED:mj-evidence:'+required[1]);
 const skipped=rows();skipped[1]!.assertionResults[0]!.status='pending';expect(await readCoverage(skipped)).toContain('SUITE_FILE_SKIPPED:mj-evidence:'+required[1]);
});
