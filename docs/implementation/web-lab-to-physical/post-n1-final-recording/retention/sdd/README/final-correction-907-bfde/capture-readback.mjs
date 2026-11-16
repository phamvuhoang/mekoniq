import {readFile,writeFile} from 'node:fs/promises';import {assessCapture} from '../../../../scripts/browser-capture-clock.mjs';
const r=JSON.parse(await readFile(process.argv[2],'utf8')),verdict=assessCapture(r);await writeFile(process.argv[3],JSON.stringify(verdict,null,2)+'\n');console.log(JSON.stringify(verdict));if(!verdict.valid||!verdict.meetsTargets)process.exitCode=1;
