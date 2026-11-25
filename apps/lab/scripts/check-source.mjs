import {checkedRuntime} from './runtime-artifact.mjs';
import {fileURLToPath} from 'node:url';
try {const {lock}=await checkedRuntime(fileURLToPath(new URL('../',import.meta.url)));console.log(`Verified source ${lock.sourceCommit}; schema ${lock.schemaHash}; protocol ${(lock.protocolMajors??[lock.protocolMajor]).join('/')}; Node ${lock.nodeMajor}`);}
catch(e){console.error(`Runtime unavailable: ${e.code==='ENOENT'?'RUNTIME_NOT_INSTALLED':e.message}. The Lab opens in preview only mode. Install a pinned export with node scripts/import-runtime.mjs <directory>.`);process.exitCode=1;}
