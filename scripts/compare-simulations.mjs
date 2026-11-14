#!/usr/bin/env node
// Offline consumer. Input JSON embeds byte-bound report/documents/chunks; comparison opens no runtime or database.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {tsImport} from 'tsx/esm/api';
const {buildSemanticStudy}=await tsImport('../packages/lab-runtime/src/v2/simulation3d/semantic-study.ts',import.meta.url);
const args=process.argv.slice(2);
try{
 if(args.length!==4||args[0]!=='--study'||args[2]!=='--out'||args[1]===args[3])throw Error('Usage: node scripts/compare-simulations.mjs --study STUDY_INPUT_JSON --out NEW_REPORT_JSON');
 const stat=await lstat(args[1]);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>200*1024*1024)throw Error('STUDY_INPUT_LIMIT_OR_PATH');
 const study=buildSemanticStudy(JSON.parse(await readFile(args[1],'utf8')));
 await writeFile(args[3],JSON.stringify(study,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({status:study.status,accepted:study.accepted,reasonCodes:study.reasonCodes,runs:study.runs.length}));process.exitCode=study.status==='complete'?0:1;
}catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
