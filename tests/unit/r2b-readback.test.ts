import {expect,test} from 'vitest';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
// @ts-expect-error ESM tooling
import * as r2b from '../../scripts/r2b-readback.mjs';
test('directory readback refuses summary-only and accepted candidates instead of trusting caller booleans',async()=>{
 const root=await mkdtemp(join(tmpdir(),'r2b-readback-'));try{await writeFile(join(root,'qualification.json'),JSON.stringify({release:'r2b',scope:'full',schemaVersion:1,documentType:'sim-extension-qualification',accepted:true,acceptedBy:'reviewer',acceptedAt:'now',artifactsVerified:true,cases:{},gates:{},suites:[],artifacts:[]}));const issues=await r2b.verifyR2bDirectory(root);expect(issues).toContain('RECORD_ACCEPTED');for(const code of ['R2A_RECORD_MISSING','PHYSICS_CAMPAIGN_MISSING','CELL_CAMPAIGN_MISSING','SEMANTIC_STUDY_MISSING','WEB_CAPTURE_MISSING'])expect(issues.some((s:string)=>s.startsWith(code)),code).toBe(true);}finally{await rm(root,{recursive:true,force:true});}
});
