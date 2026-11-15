#!/usr/bin/env node
// Offline supplied-artifact verification; no native case or prerequisite probe is launched.
import {resolve,dirname,basename} from 'node:path';
import {boundedEvidenceRead} from './r2b-readback.mjs';
import {verifyR3Directory,verifyR3Sidecar} from './r3-readback.mjs';
const [directory,flag,file,...rest]=process.argv.slice(2);
try{
 if(!directory||rest.length||flag&&flag!=='--sidecar'||flag&&!file||!flag&&file)throw Error('USAGE: verify-r3.mjs DIR [--sidecar SIDECAR_FILE]');
 const root=resolve(directory),issues=file?await verifyR3Sidecar(root,JSON.parse(boundedEvidenceRead(dirname(resolve(file)),basename(file)))):await verifyR3Directory(root);
 console.log(JSON.stringify({valid:!issues.length,accepted:false,issues,note:'Supplied artifact consistency only; sidecar authorship/signature and host provenance require independent review.'},null,2));process.exitCode=issues.length?1:0;
}catch(e){console.error(e.message);process.exitCode=2;}
