#!/usr/bin/env node
// pnpm lab:irsim — the pinned source runtime with the portable IR-SIM 2D provider and LinkForge shadow validation switched on, plus the Lab UI, on loopback.
// pnpm lab:webots (--provider webots) — the same runtime with the Webots 3D provider instead: it also needs the host Webots R2025a (--webots-home, default /Applications/Webots.app),
// which the launcher never installs; a missing or different Webots exits before any port is opened.
// pnpm lab:mujoco (--provider mujoco) — the same runtime with the MuJoCo arm provider (MJ-BV01: the xArm 6 and its G2 gripper as a MuJoCo plant) and the mock backends only:
// Add --mujoco-mobile for Serve free-payload experiments: it verifies the pinned engineering helper Python (--irsim-python) and catalog.
// --mujoco-python (default <source>/.venv-mujoco/bin/python) must hold its lock exactly; no engineering catalog. The worker runs in the run's directory under --data-dir,
// which must lie outside every tool root (the engine writes MUJOCO_LOG.TXT into its working directory when it warns).
// Developer Mac/Linux only. It never downloads or installs anything, never falls back to the mock launcher, never stops a process it did not start.
// Before spawning it verifies: the pinned artifact carries portableSimulationTools; the source tool tree is exactly that closure; each worker venv is
// CPython 3.11 with every package of its lock installed at the locked version. Any failure exits 1 with a code; `pnpm lab:mock` is unaffected.
// Options: --source <dir> (default ../source) --irsim-python <path> (default <source>/.venv-irsim/bin/python) --linkforge-python <path>
// (default <source>/.venv-linkforge/bin/python), plus every lab:mock option (--ui-port 4175 --runtime-port 4176 --data-dir --root --boot-only).
// The source runtime accepts browser traffic only from 127.0.0.1:4175/4176, so other ports serve only non-browser checks.
import {execFile,spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {mkdir,readFile,writeFile,access,constants,stat} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {mkdtempSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {launch,checkHealth,MOCK_BACKENDS} from './start-mock.mjs';
import {installedManifest,verifyPortableTree} from './runtime-artifact.mjs';
const run=promisify(execFile),lab=fileURLToPath(new URL('../',import.meta.url));
export const IRSIM_BACKEND='irsim_2d',WEBOTS_BACKEND='webots_3d',WEBOTS_ARM_BACKEND='webots_arm',MUJOCO_BACKEND='mujoco_arm',WEBOTS_VERSION='R2025a';
/** The runtime must be the pinned one with exactly the mock backends plus the provider's live backends (`ids`), and advertise `capabilities`. */
function checkProvider(health,lock,ids,capabilities,code){
 for(const id of ids){
  const live=(health.backends??[]).find(b=>b.id===id);
  if(!live?.enabled||!live.installed||!live.compatible||!live.reachable)throw new Error(`${code}_PROVIDER_UNAVAILABLE:${live?.reason??'not offered'}`);
 }
 for(const c of capabilities)if(!health.capabilities?.includes(c))throw new Error(`CAPABILITY_MISSING:${c}`);
 checkHealth({...health,backends:health.backends.filter(b=>!ids.includes(b.id))},lock);
}
/** IR-SIM: a live irsim_2d, engineering and IR-SIM navigation advertised. */
export const checkIRSimHealth=(health,lock)=>checkProvider(health,lock,[IRSIM_BACKEND],['engineering_bundle_v1','irsim_navigation_v1'],'IRSIM');
/** Webots: a live webots_3d and webots_arm (one flag enables both on the shared Webots), engineering, Webots navigation and the Webots arm advertised. */
export const checkWebotsHealth=(health,lock)=>checkProvider(health,lock,[WEBOTS_BACKEND,WEBOTS_ARM_BACKEND],['engineering_bundle_v1','sim3d_navigation_v1','sim3d_arm_v1'],'WEBOTS');
/** MuJoCo: a live mujoco_arm and the contact arm capability; no engineering service is needed (the cell is built from the run's project). */
export const checkMujocoMobileHealth=(health,lock)=>checkProvider(health,lock,[MUJOCO_BACKEND,'mujoco_3d'],['sim3d_arm_contact_v1','engineering_bundle_v1','sim3d_payload_experiments_v1'],'MUJOCO');
export const checkMujocoHealth=(health,lock)=>checkProvider(health,lock,[MUJOCO_BACKEND],['sim3d_arm_contact_v1'],'MUJOCO');
// Reads the venv's installed distributions with the standard library only (isolated mode: no user site, no cwd on sys.path).
const PROBE="import sys,json,importlib.metadata as m\nprint(json.dumps({'version':list(sys.version_info[:2]),'impl':sys.implementation.name,'dists':{d.metadata['Name'].lower().replace('_','-'):d.version for d in m.distributions()}}))";
const pins=(text)=>[...text.matchAll(/^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)/gm)].map(([,n,v])=>[n.toLowerCase().replace(/[_.]/g,'-'),v]);
// -I ignores PYTHON* variables, so the probe gets the bytecode switches on its command line: -B writes none, -X pycache_prefix (a private empty
// directory) reads none from __pycache__ beside any source. ponytail: one empty directory per launcher, left in tmpdir.
let prefix;const pycachePrefix=()=>prefix??=mkdtempSync(join(tmpdir(),'mekoniq-pycache-'));
/** A preflight child in its own process group, handed to the launcher's `track` at spawn (so Ctrl-C stops it and whatever it started). */
// spawn, not execFile: execFile does not honour `detached`, so its child would share the launcher's group
const spawnProbe=(python,args,{timeout,env},track)=>new Promise((ok,fail)=>{
 if(track.stopping?.())return fail(new Error('START_ABORTED'));// nothing is spawned once the launcher is stopping
 const c=spawn(python,args,{env,detached:true,stdio:['ignore','pipe','ignore']});c.groupKill=true;track(c);let stdout='';
 const t=setTimeout(()=>{try{process.kill(-c.pid,'SIGKILL');}catch{/* gone */}},timeout);
 c.stdout.on('data',d=>{stdout+=d;});c.once('error',e=>{clearTimeout(t);fail(e);});
 c.once('close',(code)=>{clearTimeout(t);try{process.kill(-c.pid,'SIGKILL');}catch{/* the group is empty */}code===0?ok({stdout}):fail(new Error(`PROBE_EXIT:${code}`));});
});
/** CPython 3.11 whose installed distributions include every `name==version` of the lock. Returns null when it matches, else the reason code. */
export async function venvProblem(python,lockText,track=()=>{}){
 try{await access(python,constants.X_OK);if(!(await stat(python)).isFile())return 'PYTHON_MISSING';}catch{return 'PYTHON_MISSING';}
 let probe;try{probe=JSON.parse((await spawnProbe(python,['-I','-B','-X',`pycache_prefix=${pycachePrefix()}`,'-c',PROBE],{timeout:20000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}},track)).stdout);}catch{return 'PYTHON_UNUSABLE';}
 if(probe.impl!=='cpython'||probe.version?.join('.')!=='3.11')return `PYTHON_UNSUPPORTED:${probe.impl}-${probe.version?.join('.')}`;
 const installed=Object.fromEntries(Object.entries(probe.dists??{}).map(([k,v])=>[k.replace(/[_.]/g,'-'),v]));
 const wrong=pins(lockText).filter(([n,v])=>installed[n]!==v).map(([n,v])=>`${n}==${v}${installed[n]?` (found ${installed[n]})`:' (missing)'}`);
 return wrong.length?`LOCK_MISMATCH:${wrong.slice(0,5).join(', ')}`:null;
}
export function irsimOptions(argv){
 const o={source:resolve(lab,'../source'),provider:'irsim',mujocoMobile:false,irsimPython:undefined,linkforgePython:undefined,webotsPython:undefined,webotsHome:undefined,mujocoPython:undefined,rest:[]};
 const value=(i)=>{const v=argv[i];if(!v||v.startsWith('--'))throw new Error(`MISSING_VALUE:${argv[i-1]}`);return resolve(v);};
 for(let i=0;i<argv.length;i++){const a=argv[i];
  if(a==='--mujoco-mobile')o.mujocoMobile=true;else if(a==='--source')o.source=value(++i);else if(a==='--irsim-python')o.irsimPython=value(++i);else if(a==='--linkforge-python')o.linkforgePython=value(++i);
  else if(a==='--provider'){const v=argv[++i];if(!['irsim','webots','mujoco'].includes(v))throw new Error(`INVALID_PROVIDER:${v}`);o.provider=v;}
  else if(a==='--webots-python')o.webotsPython=value(++i);else if(a==='--mujoco-python')o.mujocoPython=value(++i);else if(a==='--webots-home')o.webotsHome=value(++i);else o.rest.push(a);}
 o.irsimPython??=join(o.source,'.venv-irsim/bin/python');o.linkforgePython??=join(o.source,'.venv-linkforge/bin/python');o.webotsPython??=join(o.source,'.venv-webots/bin/python');o.mujocoPython??=join(o.source,'.venv-mujoco/bin/python');o.webotsHome??=process.env.MEKONIQ_WEBOTS_HOME?resolve(process.env.MEKONIQ_WEBOTS_HOME):'/Applications/Webots.app';
 return o;
}
/** The pinned artifact carries `need`; the source tool tree is exactly the pinned closure; each venv of `venvs` ([tool id, python, code]) matches its tool's lock. */
async function verifiedTools(o,launch_,lock,need,missing,venvs,track){
 const manifest=await installedManifest(launch_.root,lock),p=manifest.portableSimulationTools;
 if(!p?.tools?.some(t=>t.id===need))throw new Error(`PORTABLE_TOOLS_NOT_IN_ARTIFACT: ${missing}`);
 const mismatch=await verifyPortableTree(p,o.source);
 if(mismatch.length)throw new Error(`PORTABLE_TOOLS_MISMATCH: ${mismatch.slice(0,5).join(', ')}${mismatch.length>5?` (+${mismatch.length-5})`:''}. The tools in ${o.source} are not the pinned closure ${p.closure.digest.slice(0,12)}.${mismatch.some(m=>m.endsWith(':BYTECODE'))?` Bytecode is never pinned: remove it yourself (e.g. find <tool root> -name __pycache__ -prune -exec rm -rf {} +; the launcher never deletes files).`:''}`);
 const tool=(id)=>p.tools.find(t=>t.id===id),root=(id)=>join(o.source,tool(id).root);
 for(const [id,python,code] of venvs){
  const problem=await venvProblem(python,await readFile(join(o.source,tool(id).lock.path),'utf8'),track);
  if(problem)throw new Error(`${code}_${problem}: ${python}. Provision it explicitly from ${tool(id).lock.path} (the launcher never installs).`);
 }
 return {p,tool,root};
}
/** The server-owned component catalog of a launcher: a fixture's components and models, taken from the verified closure. */
async function writeCatalog(fixtureFile,catalog,id){
 const fixture=JSON.parse(await readFile(fixtureFile,'utf8'));
 for(const d of ['components','models','documents'])await mkdir(join(catalog,d),{recursive:true});
 const entries=[];
 for(const [digest,c] of Object.entries(fixture.components)){const file=`components/${digest}.json`;await writeFile(join(catalog,file),JSON.stringify(c));entries.push({file,digest});}
 for(const [digest,m] of Object.entries(fixture.models??{}))await writeFile(join(catalog,'models',`${digest}.json`),JSON.stringify(m));
 await writeFile(join(catalog,'catalog.json'),JSON.stringify({schemaVersion:1,id,components:entries,quotes:[]}));
 return catalog;
}
/** Every check before a process is spawned; returns the runtime argv and env for the verified tools. */
export async function prepareIRSim(o,launch_,lock,track=()=>{}){
 const {tool,root}=await verifiedTools(o,launch_,lock,'irsim_worker','the pinned runtime predates portable simulation; import an export that carries portableSimulationTools.',[['irsim_worker',o.irsimPython,'IRSIM'],['linkforge_worker',o.linkforgePython,'LINKFORGE']],track);
 const catalog=await writeCatalog(join(root('irsim_worker'),'fixtures/serve-demo-v1/serve-components.json'),join(launch_.dataDir,'irsim-catalog'),'serve-demo-v1');
 const simulation=join(o.source,tool('description_helper').root,'..');
 return {readyMs:60000,backends:[...MOCK_BACKENDS,IRSIM_BACKEND].join(', '),env:{MEKONIQ_LAB_IRSIM:'1',MEKONIQ_LAB_LINKFORGE:'1'},
  args:['--engineering-catalog',catalog,'--engineering-simulation',simulation,'--engineering-python',o.irsimPython,'--linkforge-python',o.linkforgePython,'--linkforge-worker',root('linkforge_worker'),
   '--irsim-python',o.irsimPython,'--irsim-worker',root('irsim_worker'),'--irsim-lock',join(o.source,tool('irsim_worker').lock.path)]};
}
/** Webots R2025a installed at `home`: the executable exists and says R2025a. Returns null, or the reason code. The launcher never installs or downloads it. */
export async function webotsProblem(home){
 const exe=join(home,'Contents/MacOS/webots');
 try{await access(exe,constants.X_OK);}catch{return `WEBOTS_NOT_INSTALLED: no executable at ${exe}`;}
 try{
  const {stdout}=await run(exe,['--version'],{timeout:30000,env:{PATH:'/usr/bin:/bin',HOME:homedir()}});
  return stdout.includes(WEBOTS_VERSION)?null:`WEBOTS_VERSION_MISMATCH: ${stdout.trim().slice(0,80)||'no version'} at ${exe}, this Lab pins ${WEBOTS_VERSION}`;
 }catch{return `WEBOTS_NOT_INSTALLED: ${exe} does not run`;}
}
/** Every check before a process is spawned, for the Webots provider; returns the runtime argv and env for the verified tools. */
export async function prepareWebots(o,launch_,lock,track=()=>{}){
 // the engineering service's description helpers run in the IR-SIM venv (PyYAML), so it must match its lock too; the Webots worker has its own venv
 const {tool,root}=await verifiedTools(o,launch_,lock,'webots_worker','the pinned runtime predates the Webots provider; import an export that carries the webots_worker tool.',[['webots_worker',o.webotsPython,'WEBOTS'],['irsim_worker',o.irsimPython,'IRSIM']],track);
 const host=await webotsProblem(o.webotsHome);
 if(host)throw new Error(host);
 const catalog=await writeCatalog(join(root('webots_worker'),'fixtures/serve-3d-v1/serve-3d-components.json'),join(launch_.dataDir,'webots-catalog'),'serve-3d-v1');
 const simulation=join(o.source,tool('description_helper').root,'..');
 return {readyMs:120000,backends:[...MOCK_BACKENDS,WEBOTS_BACKEND,WEBOTS_ARM_BACKEND].join(', '),env:{MEKONIQ_LAB_WEBOTS:'1',MEKONIQ_WEBOTS_HOME:o.webotsHome},
  args:['--engineering-catalog',catalog,'--engineering-simulation',simulation,'--engineering-python',o.irsimPython,'--webots-python',o.webotsPython,'--webots-worker',root('webots_worker'),
   '--webots-lock',join(o.source,tool('webots_worker').lock.path),'--webots-home',o.webotsHome]};
}
/** The real path of `p`: its nearest existing ancestor resolved through symbolic links, the rest appended as given. */
const realish=(p)=>{const parts=[];let d=resolve(p);for(;;){try{return join(realpathSync(d),...parts.reverse());}catch{const up=dirname(d);if(up===d)return resolve(p);parts.push(basename(d));d=up;}}};
/** Every check before a process is spawned, for the MuJoCo arm provider: the pinned closure, .venv-mujoco against its lock, and a data directory outside every tool root
 * (the worker runs in a run directory under it, and the engine writes MUJOCO_LOG.TXT into its working directory when it warns). Mobile opt-in additionally verifies the engineering Python and writes its pinned catalog. */
export async function prepareMujoco(o,launch_,lock,track=()=>{}){
 // first, before any probe: compared as real paths (a symbolic link into a tool root is inside it), the missing tail of a directory not created yet kept as given
 const tools=(await installedManifest(launch_.root,lock)).portableSimulationTools?.tools??[],data=realish(launch_.dataDir);
 const inside=tools.map(t=>realish(join(o.source,t.root))).find(r=>data===r||data.startsWith(`${r}/`));
 if(inside)throw new Error(`DATA_DIR_IN_TOOL_ROOT: ${data} is inside the pinned tool root ${inside}; choose a --data-dir outside the source tools (the launcher never writes into them).`);
 const {tool,root}=await verifiedTools(o,launch_,lock,'mujoco_worker','the pinned runtime predates the MuJoCo arm provider; import an export that carries the mujoco_worker tool.',[['mujoco_worker',o.mujocoPython,'MUJOCO'],...o.mujocoMobile?[['irsim_worker',o.irsimPython,'ENGINEERING']]:[]],track);
 const engineering=o.mujocoMobile?['--engineering-catalog',await writeCatalog(join(root('mujoco_worker'),'fixtures/serve-payload-v1/serve-3d-components.json'),join(launch_.dataDir,'mujoco-catalog'),'serve-payload-v1'),'--engineering-simulation',join(o.source,tool('description_helper').root,'..'),'--engineering-python',o.irsimPython]:[];
 return {readyMs:60000,backends:[...MOCK_BACKENDS,MUJOCO_BACKEND,...o.mujocoMobile?['mujoco_3d']:[]].join(', '),env:{MEKONIQ_LAB_MUJOCO:'1'},
  args:[...engineering,'--mujoco-python',o.mujocoPython,'--mujoco-worker',root('mujoco_worker'),'--mujoco-lock',join(o.source,tool('mujoco_worker').lock.path)]};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let o;try{o=irsimOptions(process.argv.slice(2));}catch(e){console.error(e.message);process.exit(1);}
 await launch(o.provider==='mujoco'
  ?{argv:o.rest,prepare:(l,lock,track)=>prepareMujoco(o,l,lock,track),check:o.mujocoMobile?checkMujocoMobileHealth:checkMujocoHealth,banner:o.mujocoMobile?'Mekoniq Robot Lab — MuJoCo Serve payload + arm twins (assumed parameters, not_calibrated; ground_truth localization; no robot hardware)':'Mekoniq Robot Lab — MuJoCo arm twin (xArm 6 + G2 as a MuJoCo plant: manufacturer nominal masses and limits, every other parameter assumed, not_calibrated; no robot hardware)'}
  :o.provider==='webots'
  ?{argv:o.rest,prepare:(l,lock,track)=>prepareWebots(o,l,lock,track),check:checkWebotsHealth,banner:'Mekoniq Robot Lab — Webots 3D twin (host Webots R2025a, assumed physical parameters, not_calibrated; no robot hardware, not a native/Gazebo run)'}
  :{argv:o.rest,prepare:(l,lock,track)=>prepareIRSim(o,l,lock,track),check:checkIRSimHealth,banner:'Mekoniq Robot Lab — IR-SIM 2D twin (portable simulation; no robot hardware, not a native/Gazebo run)'});
}
