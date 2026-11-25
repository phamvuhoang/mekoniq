#!/usr/bin/env node
// node scripts/import-calibration-log.mjs --sidecar FILE --out NEW-DATASET.json   (R4-C step 3, V14)
// Exit 0: imported and written. 1: the log was read and refused (issues on stderr, one per line). 2: input unreadable, bad usage or --out already exists. Log files are read from the sidecar's directory only
// (no absolute path, no `..`, no symlink out of it); nothing is uploaded, converted or reordered, and the output file is never overwritten.
import {open,readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {tsImport} from 'tsx/esm/api';
const arg=name=>{const i=process.argv.indexOf(`--${name}`);return i>=0?process.argv[i+1]:undefined;};
const [sidecarPath,out]=[arg('sidecar'),arg('out')];
if(!sidecarPath||!out||process.argv.length!==6){console.error('usage: import-calibration-log.mjs --sidecar FILE --out NEW-DATASET.json');process.exit(2);}
if(await stat(resolve(out)).then(()=>true,()=>false)){console.error(`OUT_EXISTS: ${out}`);process.exit(2);}
let sidecar;try{sidecar=JSON.parse(await readFile(resolve(sidecarPath),'utf8'));}catch{console.error(`SIDECAR_UNREADABLE: ${sidecarPath}`);process.exit(2);}
const {importCalibrationLog,CALIBRATION_LOG_LIMITS}=await tsImport('../packages/lab-runtime/src/engineering/calibration-import.ts',import.meta.url);
const base=await realpath(dirname(resolve(sidecarPath)));
const readText=async file=>{
 const path=await realpath(join(base,file));
 if(!path.startsWith(base+sep))throw Error('LOG_PATH_REJECTED');
 const handle=await open(path,'r');
 try{const {size}=await handle.stat();if(size>CALIBRATION_LOG_LIMITS.bytes)throw Error('LOG_TOO_LARGE');return await handle.readFile('utf8');}finally{await handle.close();}
};
const r=await importCalibrationLog(sidecar,readText);
if(!r.ok){for(const issue of r.issues)console.error(issue);process.exit(1);}
await writeFile(resolve(out),JSON.stringify(r.dataset,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({dataset:resolve(out),sourceKind:r.dataset.sourceKind,trials:r.dataset.trials.length,rawDigest:r.dataset.rawDigest}));
