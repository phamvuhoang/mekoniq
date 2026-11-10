#!/usr/bin/env node
// Headless algorithm oracles: Robotics Toolbox kinematics (ALG01-03, ALG05) and the PID reference (PID01-03). Independent of the Lab UI and of any plant.
//   node scripts/lab-algorithm.mjs run --out DIR [--seed N] [--python PATH]
// Writes DIR/algorithm-results.json = {results: AlgorithmResultV1[], oracleProfileDigest, lockDigest}. DIR must not exist.
// Exit codes: 0 every check passed, 1 a check failed, 2 a prerequisite or the usage is missing (not_run). A missing venv is never a pass.
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage=(m)=>{console.error(`${m}\nusage: lab-algorithm.mjs run --out DIR [--seed N] [--python PATH]`);process.exit(2);};
const SCHEMA={run:{out:'path',seed:'int',python:'path'}};
export function parse(command,argv){
 const schema=SCHEMA[command];if(!schema)usage(`UNKNOWN_COMMAND:${command??''}`);
 const o={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];if(!a.startsWith('--'))usage(`UNEXPECTED_ARGUMENT:${a}`);
  const key=a.slice(2),kind=schema[key];if(!kind)usage(`UNKNOWN_OPTION:${a}`);
  if(Object.hasOwn(o,key))usage(`DUPLICATE_OPTION:${a}`);
  const v=argv[++i];if(v===undefined||v.startsWith('--'))usage(`MISSING_VALUE:${a}`);
  if(kind==='int'&&!/^[0-9]{1,9}$/.test(v))usage(`INVALID_INT:${a}`);
  if(/[\0\n\r]/.test(v)||v.length>1024)usage(`INVALID_VALUE:${a}`);
  o[key]=kind==='int'?Number(v):resolve(v);
 }
 if(!o.out)usage('MISSING_OPTION:--out');
 return o;
}
/** Any fail wins over not_run: a failure is information, an absent prerequisite is not. */
export const exitCodeFor=(results)=>results.some(r=>r.verdict==='fail')?1:results.length===0||results.some(r=>r.verdict==='not_run')?2:0;
async function main(){
 const [command,...argv]=process.argv.slice(2),o=parse(command,argv);
 if(existsSync(o.out))usage(`OUT_EXISTS:${o.out}`);
 const {tsImport}=await import('tsx/esm/api'),load=(f)=>tsImport(`../packages/lab-runtime/src/${f}`,import.meta.url);
 const [{createAlgorithmChecker,loadOracleProfile},{runKinematicsCases},{runPidCases},{lockDigestOf}]=await Promise.all([load('v2/algorithm/checker.ts'),load('v2/algorithm/kinematics-cases.ts'),load('v2/algorithm/pid-cases.ts'),load('engineering/linkforge.ts')]);
 const seed=o.seed??7,{profile,digest}=loadOracleProfile(),checker=createAlgorithmChecker({python:o.python??join(root,'.venv-algorithm/bin/python'),root:join(root,'robotics/algorithm')});
 const results=[...await runKinematicsCases(checker,profile,seed),...await runPidCases(checker,profile,seed)];
 await mkdir(o.out,{recursive:true});
 await writeFile(join(o.out,'algorithm-results.json'),JSON.stringify({results,oracleProfileDigest:digest,lockDigest:await lockDigestOf(join(root,'robotics/algorithm/requirements.lock'))},null,2)+'\n');
 for(const r of results)console.log(`${r.caseId} ${r.verdict}${r.reasons.length?`  ${r.reasons[0]}`:''}`);
 return exitCodeFor(results);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exit(await main());
