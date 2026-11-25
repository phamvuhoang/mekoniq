// Shared by the Node 24 Lab recorder and source acceptance. This is evidence tooling, not runtime code.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {labCommit,sourceCommit,LAB_PREFIX} from '../../scripts/repo-identity.mjs';
export const LAB_EVIDENCE_MUTABLE_PATHS=['docs/','README.md','config/simulation-compatibility.json'] as const;
export interface RepositoryIdentity {commit:string;codeHash:string;dirtyCodePaths:string[]}
export interface RegressionIdentity {source:RepositoryIdentity;lab:RepositoryIdentity}
export interface RegressionIdentityRecord {
 revisions:{source:string;sourceDirty:boolean;lab:string;labDirty:boolean};
 identity:{schema:'regression-identity/1';start:RegressionIdentity;end:RegressionIdentity;checkpoints:{id:string;identity:RegressionIdentity}[]};
 commands:{id:string}[];
}
// Qualification artifacts make ls-tree exceed Node's default 1 MiB buffer. Keep the complete listing (and a bounded failure), never truncate the identity input.
const git=(directory:string,args:string[])=>execFileSync('git',['-C',directory,...args],{encoding:'utf8',maxBuffer:64*1024*1024});
const mutableLabPath=(path:string)=>LAB_EVIDENCE_MUTABLE_PATHS.some(p=>p.endsWith('/')?path.startsWith(p):path===p);
// One repository: the Lab is apps/lab of the source directory. Source = every path outside it; the Lab listing drops the prefix so a hash compares with the standalone Lab's.
const PREFIX=`${LAB_PREFIX}/`,entryPath=(e:string)=>e.slice(e.indexOf('\t')+1),inLab=(p:string)=>p.startsWith(PREFIX);
const isEmbedded=(source:string,lab:string)=>resolve(source,LAB_PREFIX)===resolve(lab);
function treeHash(directory:string,revision:string,lab:boolean,embedded=false){
 let entries=git(directory,['ls-tree','-r','-z',revision]).split('\0').filter(Boolean);
 // a revision from before the merge is a standalone Lab or source commit: its entries are already in that repository's own layout
 if(embedded){const own=entries.filter(e=>inLab(entryPath(e)));entries=lab?(own.length?own.map(e=>e.replace(`\t${PREFIX}`,'\t')):entries):entries.filter(e=>!inLab(entryPath(e)));}
 entries=entries.filter(e=>!lab||!mutableLabPath(entryPath(e))).sort();
 return createHash('sha256').update(entries.join('\0')).digest('hex');
}
function repositoryIdentity(directory:string,lab:boolean,embedded=false):RepositoryIdentity {
 const commit=embedded?(lab?labCommit(directory):sourceCommit(directory)):git(directory,['rev-parse','HEAD']).trim();
 // --no-renames includes both ends of a move: moving code under docs cannot make the deletion invisible.
 const side=(p:string)=>!embedded||inLab(p)===lab,cut=(p:string)=>embedded&&lab?p.slice(PREFIX.length):p;
 const dirty=[...git(directory,['diff','--cached','--no-renames','--name-only','-z','HEAD']).split('\0'),...git(directory,['diff','--no-renames','--name-only','-z']).split('\0'),...git(directory,['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean).filter(side).map(cut);
 return {commit,codeHash:treeHash(directory,commit,lab,embedded),dirtyCodePaths:[...new Set(dirty.filter(p=>!lab||!mutableLabPath(p)))].sort()};
}
export function captureRegressionIdentity(sourceDirectory:string,labDirectory:string):RegressionIdentity {
 const embedded=isEmbedded(sourceDirectory,labDirectory);
 return {source:repositoryIdentity(sourceDirectory,false,embedded),lab:repositoryIdentity(embedded?sourceDirectory:labDirectory,true,embedded)};
}
export function assertRecordableIdentity(identity:RegressionIdentity){
 for(const repo of ['source','lab'] as const)if(identity[repo].dirtyCodePaths.length)throw new Error(`${repo.toUpperCase()}_CODE_DIRTY: ${identity[repo].dirtyCodePaths.join(', ')}`);
}
/** Recording holds both HEADs fixed. Documentation outputs may change, but code must be clean at every sampled checkpoint. */
export function assertStableRecording(start:RegressionIdentity,current:RegressionIdentity){
 assertRecordableIdentity(start);assertRecordableIdentity(current);
 for(const repo of ['source','lab'] as const){
  if(current[repo].commit!==start[repo].commit)throw new Error(`${repo.toUpperCase()}_REVISION_CHANGED_DURING_RECORDING`);
  if(current[repo].codeHash!==start[repo].codeHash)throw new Error(`${repo.toUpperCase()}_CODE_CHANGED_DURING_RECORDING`);
 }
}
/** Later Lab commits may change only the explicit documentation/evidence paths; source stays exact-HEAD and fully clean. */
export function assertRecordedRegressionIdentity(record:RegressionIdentityRecord,sourceDirectory:string,labDirectory:string){
 if(record.identity?.schema!=='regression-identity/1')throw new Error('REGRESSION_IDENTITY_MISSING');
 const {start,end,checkpoints}=record.identity;
 if(record.revisions.sourceDirty!==false||record.revisions.labDirty!==false)throw new Error('RECORDED_CODE_DIRTY');
 if(record.revisions.source!==start.source.commit||record.revisions.lab!==start.lab.commit)throw new Error('RECORDED_REVISION_MISMATCH');
 assertStableRecording(start,end);
 for(const checkpoint of checkpoints)assertStableRecording(start,checkpoint.identity);
 for(const command of record.commands)for(const phase of ['before','after'])if(!checkpoints.some(c=>c.id===`${command.id}:${phase}`))throw new Error('REGRESSION_CHECKPOINT_MISSING');
 const current=captureRegressionIdentity(sourceDirectory,labDirectory);assertRecordableIdentity(current);
 if(current.source.commit!==start.source.commit)throw new Error('SOURCE_REVISION_STALE');

 const embedded=isEmbedded(sourceDirectory,labDirectory);
 for(const [repo,directory] of [['source',sourceDirectory],['lab',embedded?sourceDirectory:labDirectory]] as const){
  if(treeHash(directory,start[repo].commit,repo==='lab',embedded)!==start[repo].codeHash)throw new Error('RECORDED_CODE_HASH_MISMATCH');
  if(current[repo].codeHash!==start[repo].codeHash)throw new Error(`${repo.toUpperCase()}_CODE_STALE`);
 }
}

/** Where the recorded regression manifest lives: LAB_V2_REGRESSION_DIR (absolute, or relative to the Lab) or, when unset, the historical digital-twin-v2 path. */
export function regressionRoot(env:string|undefined,lab:string):string{
 return env?resolve(lab,env):resolve(lab,'docs/implementation/evidence/digital-twin-v2/regression');
}
