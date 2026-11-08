import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {createPythonCompiler} from './compiler';
import {loadCatalog} from './catalog';
import {createEngineeringService,type EngineeringService} from './gateway';
import {createLinkForgeValidator,lockDigestOf,type RobotModelValidator} from './linkforge';

const run=promisify(execFile);
export interface EngineeringRuntimeOptions{
 /** Run data directory; the bundle store lives in <directory>/engineering. */
 directory:string;
 /** Opt-in. Without a catalog the runtime offers no engineering at all. */
 catalogRoot?:string;
 simulationRoot?:string;
 python?:string;
 /**
  * Shadow validation (MEKONIQ_LAB_LINKFORGE=1, decided by the operator, never by a request). Omit it and every validation is `not_run: LINKFORGE_DISABLED`.
  * Present but unusable (no interpreter, linkforge-core missing) leaves the engineering service up and reports `LF_WORKER_UNAVAILABLE`: compile and run are unaffected.
  */
 linkforge?:{python:string;workerRoot:string;timeoutMs?:number};
}
/**
 * Builds the engineering service only when the operator asked for it and everything it needs works right now: a readable catalog and a compiler whose Python
 * dependencies import. Anything less throws, so the `engineering_bundle_v1` capability is never advertised for a service that would fail every request.
 * Native execution is a separate fact and stays unqualified: bundles compile as runnable:false.
 */
export async function engineeringFromOptions(o:EngineeringRuntimeOptions):Promise<EngineeringService|undefined>{
 if(!o.catalogRoot&&!o.simulationRoot)return undefined;
 if(!o.catalogRoot)throw new Error('ENGINEERING_CATALOG_REQUIRED');
 if(!o.simulationRoot)throw new Error('ENGINEERING_SIMULATION_ROOT_REQUIRED');
 const simulationRoot=resolve(o.simulationRoot),catalogRoot=resolve(o.catalogRoot),python=o.python??'python3';
 if(!await stat(join(simulationRoot,'compiler','engineering.py')).then(s=>s.isFile(),()=>false))throw new Error('ENGINEERING_SIMULATION_ROOT_INVALID');
 const catalog=await loadCatalog(catalogRoot);
 if(!Object.keys(catalog.components).length)throw new Error(`ENGINEERING_CATALOG_UNREADABLE: ${catalog.problems[0]?.code??'empty'}`);
 try{await run(python,['-c','import rfc8785, jsonschema, referencing, yaml'],{timeout:15_000});}
 catch{throw new Error('ENGINEERING_COMPILER_UNAVAILABLE: the Python interpreter lacks rfc8785, jsonschema, referencing or PyYAML (see robotics/simulation/requirements-dev.txt)');}

 let validator:RobotModelValidator|undefined,validationUnavailable='LINKFORGE_DISABLED';
 if(o.linkforge){
  const workerRoot=resolve(o.linkforge.workerRoot);
  try{
   await run(o.linkforge.python,['-c','import linkforge.core'],{timeout:15_000});
   validator=createLinkForgeValidator({python:o.linkforge.python,workerRoot,timeoutMs:o.linkforge.timeoutMs??30_000,lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock'))});
  }catch{validationUnavailable='LF_WORKER_UNAVAILABLE';}
 }
 return createEngineeringService({directory:join(o.directory,'engineering'),catalogRoot,compiler:createPythonCompiler({python,simulationRoot}),validator,validationUnavailable});
}
