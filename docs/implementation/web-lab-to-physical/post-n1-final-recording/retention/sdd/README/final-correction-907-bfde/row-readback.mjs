import {readFile,writeFile} from 'node:fs/promises';
import {tableR2b,checkR2bExecutedFiles,validateR2bSelectors} from '../../../../scripts/sim-extension-r2b.mjs';
import {summarizeResult} from '../../../../scripts/irsim-qualification.mjs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const table=tableR2b(),suite=table.suites.find(s=>s.id==='mj-evidence');validateR2bSelectors(table,{source:process.cwd(),lab:resolve('../lab')});const bytes=await readFile(process.argv[2]),problems=checkR2bExecutedFiles(suite,bytes),result={suite,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,summary:summarizeResult('vitest',bytes.toString()),problems};await writeFile(process.argv[3],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(problems.length)process.exitCode=1;
