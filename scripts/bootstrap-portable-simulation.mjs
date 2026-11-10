// Provisions the isolated portable-simulation worker venvs from hash-locked requirements. Never run implicitly at runtime.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join, resolve} from 'node:path';
const run=promisify(execFile), root=resolve(fileURLToPath(import.meta.url),'../..');
export const WORKERS={linkforge:{dir:'robotics/model-validation',venv:'.venv-linkforge'},irsim:{dir:'robotics/navigation-2d',venv:'.venv-irsim'},algorithm:{dir:'robotics/algorithm',venv:'.venv-algorithm'}};
export const sha256=(text)=>createHash('sha256').update(text).digest('hex');
/** portable-worker-lock/1 metadata; packages come from `pip freeze`, sorted by name so the output is deterministic. */
export function lockMetadata({pythonVersion,platform,freeze,requirementsText}){
 const packages=freeze.split('\n').map(l=>l.trim()).filter(l=>/^[A-Za-z0-9_.-]+==/.test(l)).map(l=>{const [name,version]=l.split('==');return {name:name.toLowerCase(),version};}).sort((a,b)=>a.name<b.name?-1:1);
 return {schemaVersion:1,documentType:'portable-worker-lock',pythonVersion,platform,packages,requirementsSha256:sha256(requirementsText)};
}
export async function provision(key,{python='python3.11'}={}){
 const w=WORKERS[key], venv=join(root,w.venv), py=join(venv,'bin/python'), lock=join(root,w.dir,'requirements.lock');
 await run(python,['-m','venv',venv]);
 await run(py,['-m','pip','install','--require-hashes','--no-deps','--disable-pip-version-check','-r',lock],{maxBuffer:1<<26});
 const [{stdout:ver},{stdout:freeze}]=await Promise.all([run(py,['-c','import platform;print(platform.python_version())']),run(py,['-m','pip','freeze'])]);
 return lockMetadata({pythonVersion:ver.trim(),platform:`${process.platform}-${process.arch}`,freeze,requirementsText:readFileSync(lock,'utf8')});
}
if(import.meta.url===`file://${process.argv[1]}`){
 const keys=process.argv.slice(2).filter(k=>k in WORKERS), out={};
 for(const k of keys.length?keys:Object.keys(WORKERS)) out[k]=await provision(k);
 const dest=process.env.PORTABLE_LOCK_OUT; if(dest) writeFileSync(dest,JSON.stringify(out,null,2)+'\n'); else console.log(JSON.stringify(out,null,2));
}
