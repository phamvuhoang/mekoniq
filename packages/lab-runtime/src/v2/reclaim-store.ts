// Local ownership proof is kept apart from reports and source journals. A new pairing session must present the original opaque proof.
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile,open,rename} from 'node:fs/promises';
import {join} from 'node:path';
import type {RunManifestInput} from './scenario-runner';
interface ReclaimRecord {controlEpoch?:number;runId:string;proofHash:string;schemaHash:string;input:RunManifestInput}
export const proofHash=(proof:string)=>createHash('sha256').update(proof).digest('hex');
export async function saveReclaim(directory:string,record:ReclaimRecord){await writeFile(join(directory,'reclaim.json'),JSON.stringify(record),{mode:0o600,flag:'wx'});}
export async function findReclaim(root:string,runId:string):Promise<{directory:string;record:ReclaimRecord}|null>{
 for(const entry of await readdir(root,{withFileTypes:true}).catch(()=>[])){
  if(!entry.isDirectory())continue;
  const directory=join(root,entry.name);
  try{const record=JSON.parse(await readFile(join(directory,'reclaim.json'),'utf8')) as ReclaimRecord;if(record.runId===runId)return {directory,record};}catch{/* a non-run or an incomplete local directory is not reclaimable */}
 }
 return null;
}

/** Atomic metadata only; never persist session credentials or restart permission. */
export async function saveControlEpoch(directory:string,epoch:number){
 const path=join(directory,'reclaim.json'),record=JSON.parse(await readFile(path,'utf8')) as ReclaimRecord;
 if(!Number.isSafeInteger(epoch)||epoch<0)throw Error('INVALID_CONTROL_EPOCH');
 record.controlEpoch=Math.max(record.controlEpoch??0,epoch);const staging=join(directory,'reclaim-next.json');
 const file=await open(staging,'w',0o600);try{await file.writeFile(JSON.stringify(record));await file.sync();}finally{await file.close();}
 await rename(staging,path);const dir=await open(directory,'r');try{await dir.sync();}finally{await dir.close();}
}
