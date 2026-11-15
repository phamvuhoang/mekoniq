// Explicit retained-input admission. Missing external evidence is never a skip.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const safeRetainedPath=p=>typeof p==='string'&&/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(p)&&!p.split('/').some(x=>x==='.'||x==='..');
export function retainedInventory(root,base=''){
 const files=[];for(const name of readdirSync(join(root,base)).sort()){const path=base?`${base}/${name}`:name;if(!safeRetainedPath(path))throw Error('RETAINED_PATH');const st=lstatSync(join(root,path));if(st.isSymbolicLink())throw Error('RETAINED_SYMLINK');if(st.isDirectory())files.push(...retainedInventory(root,path));else if(st.isFile()){const b=readFileSync(join(root,path));files.push({path,bytes:b.length,sha256:sha(b)});}else throw Error('RETAINED_FILE_TYPE');}return files;
}
export function retainedInput(id,env=process.env){
 const file=env.MEKONIQ_RETAINED_INPUTS,digest=env.MEKONIQ_RETAINED_INPUTS_SHA256;
 if(!file||!digest)throw Error('RETAINED_INPUTS_NOT_CONFIGURED: set MEKONIQ_RETAINED_INPUTS and MEKONIQ_RETAINED_INPUTS_SHA256; see docs/operations/r2b-qualification.md');
 const bytes=readFileSync(file);if(sha(bytes)!==digest)throw Error('RETAINED_INVENTORY_HASH');const m=JSON.parse(bytes),entry=m.inputs?.[id];
 if(m.version!==1||!entry||!safeRetainedPath(entry.directory)||!Array.isArray(entry.files)||!entry.files.length)throw Error('RETAINED_INPUT_MISSING:'+id);
 const base=realpathSync(dirname(resolve(file))),root=join(base,entry.directory);if(realpathSync(root)!==root||!root.startsWith(base+sep))throw Error('RETAINED_PATH');
 if(JSON.stringify(retainedInventory(root))!==JSON.stringify(entry.files))throw Error('RETAINED_ARTIFACT_HASH:'+id);
 return root;
}
