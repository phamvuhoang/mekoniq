import {readFile,writeFile,rename,open,stat} from 'node:fs/promises';
import {join} from 'node:path';
/** Run checkpoint (run.json) beside the run's SQLite journal. Atomic replace; owner-only file mode.
 * A torn/empty/unparseable file (e.g. an unsynced replace cut by power loss) fails closed as RECOVERY_CHECKPOINT_CORRUPT. */
export async function readCheckpoint<T>(directory:string):Promise<T|undefined>{
 let text:string;try{text=await readFile(join(directory,'run.json'),'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
 try{return JSON.parse(text) as T;}catch{throw new Error('RECOVERY_CHECKPOINT_CORRUPT');}
}
// ponytail: whole-file rewrite per durable step (receipts included); fine for mock-sized runs, split receipts into the journal DB if runs grow to thousands of actions.
/** sync:true fsyncs the data and the directory, so the replace itself is durable. 'file' fsyncs only the data: the rename is
 * not directory-synced (except when this write creates run.json), so after a power loss run.json may still be an older image. */
export async function writeCheckpoint(directory:string,value:unknown,options:{sync?:boolean|'file'}={}):Promise<void>{
 const path=join(directory,'run.json'),created=options.sync==='file'&&!await stat(path).then(()=>true,()=>false);await writeFile(path+'.tmp',JSON.stringify(value),{mode:0o600});if(options.sync){const file=await open(path+'.tmp','r');try{await file.sync();}finally{await file.close();}}await rename(path+'.tmp',path);
 if(options.sync===true||created){const directoryHandle=await open(directory,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}}
}
