import {installRuntime,rollbackRuntime} from './runtime-artifact.mjs';
import {fileURLToPath} from 'node:url';
// node scripts/import-runtime.mjs <artifact-dir>  |  node scripts/import-runtime.mjs --rollback (re-select the previously pinned, still-installed artifact)
const root=fileURLToPath(new URL('../',import.meta.url)),arg=process.argv[2];
if(!arg)throw new Error('Usage: node scripts/import-runtime.mjs /path/to/trusted/source-export | --rollback');
const lock=arg==='--rollback'?await rollbackRuntime(root):await installRuntime(arg,root);
console.log(`${arg==='--rollback'?'Rolled back to':'Installed'} source ${lock.sourceCommit}, artifact ${lock.artifactSha256}, protocol ${(lock.protocolMajors??[lock.protocolMajor]).join('/')}. Previous pin kept in .runtime/rollback.lock.json.`);
