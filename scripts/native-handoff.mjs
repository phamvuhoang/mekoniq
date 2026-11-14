#!/usr/bin/env node
// Only fixed verifier code is imported. Manifest content is data, never argv/shell/module input.
import {tsImport} from 'tsx/esm/api';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const {validateNativeHandoff,readNativeHandoff,readHandoffFile,exportNativeHandoff}=await tsImport('../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{
 const [command,...args]=process.argv.slice(2),allowed=command==='export'?['--input','--out']:command==='verify'?['--input','--inventory']:[];
 if(!allowed.length)throw new Error('USAGE: native-handoff.mjs export --input DIR --out NEW_DIR | verify --input DIR [--inventory FILE]');
 const options={};for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.includes(key)||key in options||!value||value.startsWith('--'))throw new Error('INVALID_ARGUMENT');options[key]=value;}
 if(!options['--input']||command==='export'&&!options['--out'])throw new Error('MISSING_ARGUMENT');
 const input=resolve(options['--input']),manifest=await readNativeHandoff(input),inventoryPath=options['--inventory']&&resolve(options['--inventory']);
 const inventory=inventoryPath?JSON.parse((await readHandoffFile(dirname(inventoryPath),basename(inventoryPath))).toString('utf8')):undefined;
 const result=command==='export'?await exportNativeHandoff(input,options['--out']):await validateNativeHandoff(input,manifest,inventory);
 const files=['scripts/native-handoff.mjs','packages/lab-runtime/src/v2/sil/native-handoff.ts','packages/lab-runtime/src/v2/sil/native-handoff-documents.ts','scripts/native-sim/native-inventory.mjs','packages/contracts/schemas/native-handoff-v1.schema.json','pnpm-lock.yaml'],hash=createHash('sha256');
 for(const file of files)hash.update(file+'\n').update(await readFile(resolve(root,file)));
 let sourceCommit=null;try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:5000}).trim();}catch{/* copied checker has only its byte identity */}
 console.log(JSON.stringify({...result,subject:manifest.subject,checker:{sourceCommit,toolSha256:hash.digest('hex')},inventoryAssessment:'supplied_records_only',qualification:'not_run',accepted:false,dynamics:'not_calibrated'},null,2));
 process.exitCode=result.prepared?0:1;
}catch(error){console.error(JSON.stringify({code:'NATIVE_HANDOFF_FAILED',message:error.message,accepted:false,qualification:'not_run'}));process.exitCode=1;}
