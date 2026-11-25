import {execFileSync} from 'node:child_process';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
export async function productionBuildIdentity(lab:string,source:string,lock:{sourceCommit:string;artifactSha256:string;schemaHash:string}){
 const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8'}),sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const files:{path:string;sha256:string;bytes:number}[]=[];
 const walk=async(base:string)=>{const root=join(lab,'dist',base);if((await lstat(root)).isSymbolicLink())throw Error('BUILD_SYMLINK');for(const e of await readdir(root,{withFileTypes:true})){const path=base?base+'/'+e.name:e.name;if(e.isSymbolicLink())throw Error('BUILD_SYMLINK');if(e.isDirectory())await walk(path);else{const bytes=await readFile(join(lab,'dist',path));files.push({path,sha256:sha(bytes),bytes:bytes.length});}}};await walk('');files.sort((a,b)=>a.path.localeCompare(b.path));if(!files.length)throw Error('BUILD_MISSING');
 const identity={labHead:git(lab,'rev-parse','HEAD').trim(),labStatus:git(lab,'status','--porcelain'),sourceHead:git(source,'rev-parse','HEAD').trim(),sourceStatus:git(source,'status','--porcelain'),sourceCommit:lock.sourceCommit,runtimeArtifact:lock.artifactSha256,schemaHash:lock.schemaHash,buildSha256:sha(JSON.stringify(files)),files,node:process.version};
 if(identity.labStatus!==''||identity.sourceStatus!==''||identity.sourceHead!==lock.sourceCommit)throw Error('PRODUCTION_TUPLE_NOT_CLEAN');return identity;
}
