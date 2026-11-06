import {readFile,writeFile,rename,open} from 'node:fs/promises';
import {join} from 'node:path';
/** Run checkpoint (run.json) beside the run's SQLite journal. Atomic replace; owner-only file mode. */
export async function readCheckpoint<T>(directory:string):Promise<T|undefined>{
 try{return JSON.parse(await readFile(join(directory,'run.json'),'utf8')) as T;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
}
// ponytail: whole-file rewrite per durable step (receipts included); fine for mock-sized runs, split receipts into the journal DB if runs grow to thousands of actions.
export async function writeCheckpoint(directory:string,value:unknown,options:{sync?:boolean}={}):Promise<void>{
 const path=join(directory,'run.json');await writeFile(path+'.tmp',JSON.stringify(value),{mode:0o600});if(options.sync){const file=await open(path+'.tmp','r');try{await file.sync();}finally{await file.close();}}await rename(path+'.tmp',path);
 if(options.sync){const directoryHandle=await open(directory,'r');try{await directoryHandle.sync();}finally{await directoryHandle.close();}}
}
