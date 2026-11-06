import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {RunVerification} from '../../packages/contracts/generated/lab-v2';
import {validateVerification,verifyBundleArtifacts,withVerification,armVerificationEvidence} from '../../packages/lab-runtime/src/v2/reports/verification';
import {canonicalOutcome} from '../../packages/lab-runtime/src/v2/report';
import {openCoffee,cleanupRuns} from '../support/lab-v2';
const roots:string[]=[];afterEach(async()=>{await cleanupRuns();for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
const empty=():RunVerification=>({schemaVersion:1,execution:'not_run',result:'not_run',blockers:['NO_CONTROLLER'],target:'linux-vm-sim',aspects:[],arm:null,transfers:[],artifacts:[]});
test('missing native execution and zero coverage can never be verification pass',()=>{
 expect(validateVerification(empty()).ok).toBe(true);expect(validateVerification({...empty(),result:'pass'}).ok).toBe(false);
 expect(validateVerification({...empty(),execution:'ran',result:'pass',blockers:[]}).ok).toBe(false);
});
test('legacy mock canonical outcome is unchanged by optional verification',async()=>{
 const run=await openCoffee('BV01',{seed:42});const report=await run.report();try{expect(canonicalOutcome({...report,verification:empty()})).toEqual(canonicalOutcome(report));}finally{await run.close();}
});
test('artifact verification checks bytes and hashes and rejects traversal and symlink escapes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'report-bundle-'));roots.push(root);await mkdir(join(root,'evidence'));const bytes=Buffer.from('raw controller trace');await writeFile(join(root,'evidence','trace.json'),bytes);
 const v={...empty(),artifacts:[{path:'evidence/trace.json',bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}]};
 await expect(verifyBundleArtifacts(root,v)).resolves.toBeUndefined();
 await writeFile(join(root,'evidence','trace.json'),'tampered');await expect(verifyBundleArtifacts(root,v)).rejects.toThrow('ARTIFACT');
 for(const path of ['../escape','/etc/passwd','file:///tmp/data','evidence/../escape','evidence\\escape'])expect(validateVerification({...v,artifacts:[{...v.artifacts[0]!,path}]}).ok).toBe(false);
 const outside=await mkdtemp(join(tmpdir(),'report-outside-'));roots.push(outside);await writeFile(join(outside,'trace.json'),bytes);await symlink(outside,join(root,'link'));
 await expect(verifyBundleArtifacts(root,{...v,artifacts:[{...v.artifacts[0]!,path:'link/trace.json'}]})).rejects.toThrow('ARTIFACT_PATH');
 expect(validateVerification({...v,artifacts:[...v.artifacts,...v.artifacts]}).ok).toBe(false);
 expect(validateVerification({...v,artifacts:[{...v.artifacts[0]!,bytes:64*1024*1024},{...v.artifacts[0]!,path:'other',bytes:1}]}).ok).toBe(false);
});

test('published verification stays bound to report world and ARM03 never promotes missing evidence',async()=>{
 const run=await openCoffee('BV01',{seed:42});try{const report=await run.report();const enriched=withVerification(report,empty());expect(enriched.verification).toEqual(empty());expect(armVerificationEvidence(enriched,'a'.repeat(64)).result).toBe('not_run');expect(report.verification).toBeUndefined();}finally{await run.close();}
});
test('unexecuted verification rejects a complete arm pass and preserves not_run in evidence',async()=>{
 const run=await openCoffee('BV01',{seed:42});try{const report=await run.report();const v:RunVerification={...empty(),armTickMap:[{sampleTick:0,runTick:0,entityId:'arm-1',bootId:'boot',seq:'1'},{sampleTick:1,runTick:1,entityId:'arm-1',bootId:'boot',seq:'2'}],arm:{id:'ARM03',result:'pass',reasonCodes:[],engine:'checker',modelRevision:'a'.repeat(64),geometryRevision:'b'.repeat(64),worldRevision:report.manifest.world,assetRef:{id:'arm-puma-reference'},trace:{samples:2,fromTick:0,toTick:1},attachments:[],allowedContacts:[],method:{kind:'adaptive-subdivision',bound:'conservative',toleranceM:0.001,maxDepth:24},coverage:{intervals:1,evaluations:2,uncertain:0,allowedContactsApplied:0},colliding:[],provenance:'geometric_checker',fidelity:'modeled'}};
 expect(validateVerification(v)).toMatchObject({ok:false,reasonCodes:expect.arrayContaining(['VERIFICATION_NOT_EXECUTED'])});expect(armVerificationEvidence({...report,verification:v},'a'.repeat(64)).result).toBe('not_run');
 }finally{await run.close();}
});
