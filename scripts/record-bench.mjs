#!/usr/bin/env node
// Assembles a bench record from session parts (K07b; contracts §2.5, §7): node scripts/record-bench.mjs --identity DIR [--conformance DIR] [--measure DIR] [--sensors DIR]
// --out DIR --candidate-id ID. The source commit is the path-based one (repo-identity.mjs); a dirty source tree, an existing output or one inside a repository is refused.
// It does not check the Lab pin (the record uses no pinned runtime) and re-runs no suite: every verdict is recomputed from the stored traces. The record is read back
// before the script ends; any issue removes it. Exit 0 recorded, 1 refused, 2 bad usage. The record is accepted:false; acceptance is a human-written sidecar.
import {existsSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tsImport} from 'tsx/esm/api';
import {sourceCommit,sourceDirty} from './repo-identity.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const refuse=(code,detail='')=>{console.error(`REFUSED ${code}${detail?` ${detail}`:''}`);process.exit(code==='MISSING_OPTION'||code==='INVALID_OPTION'?2:1);};
const args=process.argv.slice(2),o={},PARTS=['identity','conformance','measure','sensors'];
for(let i=0;i<args.length;i+=2){
 const a=args[i],k=a.startsWith('--')?a.slice(2):'';
 if(![...PARTS,'out','candidate-id'].includes(k)||o[k]!==undefined)refuse('INVALID_OPTION',a);
 if(args[i+1]===undefined||args[i+1].startsWith('--'))refuse('MISSING_OPTION',`${a} needs a value`);
 o[k]=args[i+1];
}
for(const k of ['identity','out','candidate-id'])if(o[k]===undefined)refuse('MISSING_OPTION',`--${k}`);
const ts=(p)=>tsImport(join(root,'packages/bench/src',p),import.meta.url);
const {outProblem}=await ts('cli-flow.ts'),out=resolve(o.out);
if(existsSync(out))refuse('OUT_EXISTS',out);
if(outProblem(out,false))refuse(outProblem(out,false),out);
if(sourceDirty(root))refuse('SOURCE_DIRTY','commit or remove the changes outside apps/lab first');
const {assembleBenchRecord,verifyBenchRecord}=await ts('record.ts');
let record;
try{record=await assembleBenchRecord(Object.fromEntries(PARTS.filter(k=>o[k]).map(k=>[k,resolve(o[k])])),out,{candidateId:o['candidate-id'],sourceCommit:sourceCommit(root)});}
catch(e){refuse(e?.code??'RECORD_REFUSED',e?.message??String(e));}
const v=await verifyBenchRecord(out);
if(!v.ok){for(const i of v.issues)console.error(`${i.code} ${i.path}`);await rm(out,{recursive:true,force:true});refuse('RECORD_READBACK_FAILED',`${v.issues.length} issue(s); the output was removed`);}
console.log(`bench record ${record.candidateId} at source ${record.sourceCommit}: ${out}`);
for(const [g,x] of Object.entries(record.gates))console.log(`  ${g} ${x.status}`);
console.log(record.host.testLevel==='protocol_double'?'protocol_double: recorded on the simulated slave; it proves nothing about a drive, and every hardware gate stays blocked_external.'
 :'hardware: recorded on the real bus.');
console.log('accepted:false. Acceptance is a sidecar acceptance.json written by a human reviewer, bound to the sha256 of bench-record.json.');
