import {execFile} from 'node:child_process';
import {unlink,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {promisify} from 'node:util';
import type {CompilerPort} from './gateway';

const run=promisify(execFile);
export interface PythonCompilerOptions{
 /** Interpreter with rfc8785, jsonschema, referencing and PyYAML installed (the pinned simulation requirements). Default: python3. */
 python?:string;
 /** robotics/simulation of the checkout or runtime artifact. */
 simulationRoot:string;
 /** Directory with the exported contract schemas; default is the checkout's packages/contracts/schemas. */
 schemaDir?:string;
 timeoutMs?:number;
 /** Qualified native execution is a separate fact (B01/B03); a compiler that only emits files reports false. */
 runnable?:()=>boolean|Promise<boolean>;
}
/** CompilerPort over compiler/engineering.py. The subprocess gets no network and reads only the input file and the schema directory. */
export function createPythonCompiler(o:PythonCompilerOptions):CompilerPort{
 const root=resolve(o.simulationRoot);
 return {
  version:'lab-engineering-compiler/1',
  runnable:o.runnable,
  async compileResolved(input,outDir){
   // beside the staging directory, so the service's cleanup of staging never has to know about it
   const file=join(dirname(outDir),`${basename(outDir)}.input.json`);
   await writeFile(file,JSON.stringify(input),{mode:0o600});
   try{
    const env={...process.env,PYTHONPATH:[root,join(root,'..','agent')].join(':'),...o.schemaDir?{MEKONIQ_SCHEMA_DIR:resolve(o.schemaDir)}:{}};
    const {stdout}=await run(o.python??'python3',['-m','compiler','engineering','--input',file,'--out',outDir],{cwd:root,env,timeout:o.timeoutMs??55_000,maxBuffer:8*1024*1024}).catch((e:{stderr?:string;message:string})=>{throw new Error((e.stderr||e.message).trim().split('\n').pop());});
    return JSON.parse(stdout) as {sceneDigest:string;files:{path:string;sha256:string}[]};
   }finally{await unlink(file).catch(()=>{});}
  },
 };
}
