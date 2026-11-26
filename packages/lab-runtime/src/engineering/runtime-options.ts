import {execFile} from 'node:child_process';
import {stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {createPythonCompiler} from './compiler';
import {loadCatalog} from './catalog';
import {createEngineeringService,type EngineeringService} from './gateway';
import {createLinkForgeValidator,lockDigestOf,type RobotModelValidator} from './linkforge';
import {createMujocoCompiler} from './mujoco-compiler';
import {createWebotsCompiler} from './webots-compiler';
import {createNavigationCompiler} from './navigation-compiler';
import type {CompilerPort} from './gateway';
import {bytecodeEnv} from './python-env';

const run=promisify(execFile);
export interface EngineeringRuntimeOptions{
 /** Run data directory; the bundle store lives in <directory>/engineering. */
 directory:string;
 /** Explicit image profile: only registered portable compilers, no native Python fallback. */
 portableOnly?:boolean;
 /** Opt-in. Without a catalog the runtime offers no engineering at all. */
 catalogRoot?:string;
 simulationRoot?:string;
 python?:string;
 /**
  * Shadow validation (MEKONIQ_LAB_LINKFORGE=1, decided by the operator, never by a request). Omit it and every validation is `not_run: LINKFORGE_DISABLED`.
  * Present but unusable (no interpreter, linkforge-core missing) leaves the engineering service up and reports `LF_WORKER_UNAVAILABLE`: compile and run are unaffected.
  */
 linkforge?:{python:string;workerRoot:string;timeoutMs?:number};
 /**
  * Portable (IR-SIM 2D) bundles, MEKONIQ_LAB_IRSIM=1. `python` is the IR-SIM venv; `descriptionHelperRoot` defaults to the simulation root. Omitted or unusable
  * means the engineering-irsim-2d-v1 profile has no compiler and its receipts are blocked (PROFILE_COMPILER_UNAVAILABLE): never compiled by the native compiler.
  */
 portable?:{python:string;workerRoot:string;descriptionHelperRoot?:string};
 /** Webots 3D bundles, MEKONIQ_LAB_WEBOTS=1. The compiler is pure TypeScript (no interpreter needed); whether Webots itself runs is the provider's readiness. */
 webots?:boolean;
 /** Measured mobile MuJoCo compiler. Arm-only needs no engineering service. */
 mujoco?:{workerRoot:string};
}
/**
 * The base drive model of the electrical compile (fixtures/drive-v1 of the MuJoCo tool root), whatever simulation provider runs: the MuJoCo worker root when given,
 * else the sibling of the simulation root (<source>/robotics/simulation -> <source>/robotics/simulation-mujoco), the same files the offline CLI compile reads.
 * Undefined when neither holds the fixture: the electrical compile then reports UNVERIFIED_DRIVE_BASE.
 */
export async function engineeringDriveFixtureDir(o:Pick<EngineeringRuntimeOptions,'mujoco'|'simulationRoot'>):Promise<string|undefined>{
 for(const d of [o.mujoco&&join(resolve(o.mujoco.workerRoot),'fixtures/drive-v1'),o.simulationRoot&&join(resolve(o.simulationRoot),'..','simulation-mujoco','fixtures/drive-v1')])
  if(d&&await stat(join(d,'serve-drive-nominal-v1.json')).then(s=>s.isFile(),()=>false))return d;
 return undefined;
}
/**
 * Builds the engineering service only when the operator asked for it and everything it needs works right now: a readable catalog and a compiler whose Python
 * dependencies import. Anything less throws, so the `engineering_bundle_v1` capability is never advertised for a service that would fail every request.
 * Native execution is a separate fact and stays unqualified: bundles compile as runnable:false.
 */
export async function engineeringFromOptions(o:EngineeringRuntimeOptions):Promise<EngineeringService|undefined>{
 if(!o.catalogRoot&&!o.simulationRoot)return undefined;
 if(!o.catalogRoot)throw new Error('ENGINEERING_CATALOG_REQUIRED');
 if(!o.simulationRoot&&!o.portableOnly)throw new Error('ENGINEERING_SIMULATION_ROOT_REQUIRED');
 const simulationRoot=resolve(o.simulationRoot??'.'),catalogRoot=resolve(o.catalogRoot),python=o.python??'python3';
 if(!o.portableOnly&&!await stat(join(simulationRoot,'compiler','engineering.py')).then(s=>s.isFile(),()=>false))throw new Error('ENGINEERING_SIMULATION_ROOT_INVALID');
 const catalog=await loadCatalog(catalogRoot);
 if(!Object.keys(catalog.components).length)throw new Error(`ENGINEERING_CATALOG_UNREADABLE: ${catalog.problems[0]?.code??'empty'}`);
 if(!o.portableOnly)try{await run(python,['-c','import rfc8785, jsonschema, referencing, yaml'],{timeout:15_000,env:{...process.env,...bytecodeEnv()}});}
 catch{throw new Error('ENGINEERING_COMPILER_UNAVAILABLE: the Python interpreter lacks rfc8785, jsonschema, referencing or PyYAML (see robotics/simulation/requirements-dev.txt)');}

 let validator:RobotModelValidator|undefined,validationUnavailable='LINKFORGE_DISABLED';
 if(o.linkforge){
  const workerRoot=resolve(o.linkforge.workerRoot);
  try{
   await run(o.linkforge.python,['-c','import linkforge.core'],{timeout:15_000,env:{...process.env,...bytecodeEnv()}});
   validator=createLinkForgeValidator({python:o.linkforge.python,workerRoot,timeoutMs:o.linkforge.timeoutMs??30_000,lockDigest:await lockDigestOf(join(workerRoot,'requirements.lock'))});
  }catch{validationUnavailable='LF_WORKER_UNAVAILABLE';}
 }

 const compilers:Record<string,CompilerPort>={};
 if(o.portable){
  try{
   await run(o.portable.python,['-c','import yaml, rfc8785'],{timeout:15_000,env:{...process.env,...bytecodeEnv()}});
   compilers['engineering-irsim-2d-v1']=createNavigationCompiler({python:o.portable.python,workerRoot:resolve(o.portable.workerRoot),descriptionHelperRoot:resolve(o.portable.descriptionHelperRoot??simulationRoot)});
  }catch{/* the profile stays without a compiler: its receipts say so */}
 }
 if(o.mujoco)compilers['engineering-mujoco-3d-v1']=createMujocoCompiler({workerRoot:resolve(o.mujoco.workerRoot)});
 if(o.webots)compilers['engineering-webots-3d-v1']=createWebotsCompiler();
 if(o.portableOnly&&!Object.keys(compilers).length)throw Error('ENGINEERING_COMPILER_UNAVAILABLE');
 return createEngineeringService({directory:join(o.directory,'engineering'),catalogRoot,electrical:Object.keys(catalog.deviceProfiles).length>0,...await engineeringDriveFixtureDir(o).then(d=>d?{driveFixtureDir:d}:{}),...!o.portableOnly?{compiler:createPythonCompiler({python,simulationRoot})}:{},compilers,validator,validationUnavailable});
}
