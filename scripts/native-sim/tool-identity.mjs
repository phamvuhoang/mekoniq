// The executable Python import closure and its consumed local resources. Export and native admission share this definition.
import {readdirSync,readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
export function nativeToolClosure(root){
 root=realpathSync(root);const files=[];
 const walk=(relative)=>{const path=join(root,relative);if(realpathSync(path)!==resolve(path))throw new Error('NATIVE_TOOL_SYMLINK');for(const e of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){if(['__pycache__','.pytest_cache','.venv','tests'].includes(e.name)&&relative!=='tests/fixtures')continue;const r=relative+'/'+e.name;if(e.isDirectory())walk(r);else if(e.isFile()&&!/\.(pyc|pyo)$/.test(e.name)){const full=join(root,r);if(realpathSync(full)!==full)throw new Error('NATIVE_TOOL_SYMLINK');const bytes=readFileSync(full);files.push({path:r,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}else if(e.isSymbolicLink())throw new Error('NATIVE_TOOL_SYMLINK');}};
 for(const path of ['robotics/simulation','robotics/agent','packages/contracts/schemas','integrations/arm-controller/bridge','integrations/arm-controller/configs','integrations/arm-controller/models','integrations/arm-controller/programs','tests/fixtures/digital-twin'])walk(path);
 files.sort((a,b)=>a.path<b.path?-1:1);return {version:1,digest:createHash('sha256').update(JSON.stringify(files)).digest('hex'),files};
}
