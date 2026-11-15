#!/usr/bin/env node
// Only fixed verifier code is imported. Manifest content is data, never argv/shell/module input.
import {tsImport} from 'tsx/esm/api';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
import {checkedCheckerCommit} from './native-checker-bootstrap.mjs';
export {checkedCheckerCommit};

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)try{
 const sourceCommit=await checkedCheckerCommit();
 const {validateNativeHandoff,readNativeHandoff,readHandoffFile,exportNativeHandoff}=await tsImport('../packages/lab-runtime/src/v2/sil/native-handoff.ts',import.meta.url);
 const [command,...args]=process.argv.slice(2),allowed=command==='export'?['--input','--out']:command==='verify'?['--input','--inventory']:[];
 if(!allowed.length)throw new Error('USAGE: native-handoff.mjs export --input DIR --out NEW_DIR | verify --input DIR [--inventory FILE]');
 const options={};for(let i=0;i<args.length;i+=2){const key=args[i],value=args[i+1];if(!allowed.includes(key)||key in options||!value||value.startsWith('--'))throw new Error('INVALID_ARGUMENT');options[key]=value;}
 if(!options['--input']||command==='export'&&!options['--out'])throw new Error('MISSING_ARGUMENT');
 const input=resolve(options['--input']),manifest=await readNativeHandoff(input),inventoryPath=options['--inventory']&&resolve(options['--inventory']);
 const inventory=inventoryPath?JSON.parse((await readHandoffFile(dirname(inventoryPath),basename(inventoryPath))).toString('utf8')):undefined;
 const result=command==='export'?await exportNativeHandoff(input,options['--out']):await validateNativeHandoff(input,manifest,inventory);
 const files=['scripts/native-handoff.mjs','packages/lab-runtime/src/v2/sil/native-handoff.ts','packages/lab-runtime/src/v2/sil/native-handoff-documents.ts','packages/lab-runtime/src/v2/sil/native-handoff-r2a.ts','scripts/native-sim/r2a-arm-baseline.json','scripts/native-sim/native-inventory.mjs','packages/contracts/schemas/native-handoff-v1.schema.json','pnpm-lock.yaml'],hash=createHash('sha256');
 for(const file of files)hash.update(file+'\n').update(await readFile(resolve(root,file)));
 if(await checkedCheckerCommit()!==sourceCommit)throw Error('CHECKER_CHANGED_DURING_ASSESSMENT');
 console.log(JSON.stringify({...result,subject:manifest.subject,checker:{sourceCommit,toolSha256:hash.digest('hex')},inventoryAssessment:'supplied_records_only',qualification:'not_run',accepted:false,dynamics:'not_calibrated'},null,2));
 process.exitCode=result.prepared?0:1;
}catch(error){console.error(JSON.stringify({code:'NATIVE_HANDOFF_FAILED',message:error.message,accepted:false,qualification:'not_run'}));process.exitCode=1;}
