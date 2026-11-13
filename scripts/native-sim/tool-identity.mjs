// The executable Python import closure and its consumed local resources. Export and native admission share this definition.
import {readdirSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
function toolClosure(root,paths,symlink,ignorePythonMetadata=false){
 root=realpathSync(root);const files=[];
 const walk=(relative)=>{const path=join(root,relative);if(realpathSync(path)!==resolve(path))throw new Error(symlink);for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(['__pycache__','.pytest_cache','.venv','tests'].includes(e.name)&&relative!=='tests/fixtures')continue;if(ignorePythonMetadata&&/\.(egg|dist)-info$/.test(e.name))continue;const r=relative+'/'+e.name;if(e.isDirectory())walk(r);else if(e.isFile()&&!/\.(pyc|pyo)$/.test(e.name)){const full=join(root,r);if(realpathSync(full)!==full)throw new Error(symlink);const bytes=readFileSync(full);files.push({path:r,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}else if(e.isSymbolicLink())throw new Error(symlink);}};
 for(const path of paths)walk(path);
 files.sort((a,b)=>a.path<b.path?-1:1);return {version:1,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
// Editable installs generate distribution metadata in robotics/agent. It is not an imported tool or consumed resource; including it makes a clean clone export a different runtime.
// Portable roots keep their strict file inventory (the Lab launcher verifies every distributed file).
export const nativeToolClosure=(root)=>toolClosure(root,['robotics/simulation','robotics/agent','packages/contracts/schemas','integrations/arm-controller/bridge','integrations/arm-controller/configs','integrations/arm-controller/models','integrations/arm-controller/programs','tests/fixtures/digital-twin'],'NATIVE_TOOL_SYMLINK',true);
/** Portable (macOS/Linux developer) Python tools: IR-SIM worker + its fixtures, LinkForge shadow worker, the Robotics Toolbox/PID algorithm checker, the Webots 3D plant compiler/worker (the engine is a host install), the MuJoCo arm cell compiler (the engine is the pinned wheel of its lock) with its xarm6 fixture, the shared description/compiler helper with the robotics/simulation
 * packages it imports (compiler/__init__ -> compile_world -> worlds.generate_restaurant, actors.blocker/scenario/pedestrian) and the contract schemas. Separate from the native closure; neither replaces the other. */
export const PORTABLE_TOOL_PATHS=['robotics/navigation-2d','robotics/model-validation','robotics/algorithm','robotics/simulation-3d','robotics/simulation-mujoco','robotics/simulation/compiler','robotics/simulation/actors','robotics/simulation/worlds','packages/contracts/schemas'];
export const portableToolClosure=(root)=>toolClosure(root,PORTABLE_TOOL_PATHS,'PORTABLE_TOOL_SYMLINK');
