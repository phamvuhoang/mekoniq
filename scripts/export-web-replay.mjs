#!/usr/bin/env node
import {tsImport} from 'tsx/esm/api';
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--input','--out'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]])throw Error('USAGE: export-web-replay.mjs --input RUN_DIR --out NEW_DIR');options[args[i]]=args[i+1];}
if(!options['--input']||!options['--out'])throw Error('USAGE: export-web-replay.mjs --input RUN_DIR --out NEW_DIR');
try{const {loadRetainedReplay,exportWebReplay}=await tsImport('../packages/lab-runtime/src/v2/replay/export.ts',import.meta.url);const manifest=await exportWebReplay(await loadRetainedReplay(options['--input']),options['--out']);console.log(JSON.stringify({documentType:manifest.documentType,runId:manifest.runId,horizon:manifest.horizon,coverage:manifest.coverage,bytes:manifest.assets.reduce((n,a)=>n+a.bytes,0),accepted:false}));}catch(e){console.error(e.message);process.exitCode=1;}
