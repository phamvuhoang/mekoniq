// Local ownership proof is kept apart from reports and source journals. A new pairing session must present the original opaque proof.
import {createHash} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {RunManifestInput} from './scenario-runner';
interface ReclaimRecord {runId:string;proofHash:string;schemaHash:string;input:RunManifestInput}
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
