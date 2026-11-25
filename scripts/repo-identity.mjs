// One repository holds source and the Lab. "source" is every path outside apps/lab; the Lab is apps/lab.
// Recorders, the runtime export and the image build still bind a (source, Lab) pair through these four reads.
import {execFileSync} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
export const LAB_PREFIX='apps/lab';
const git=(root,...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8',maxBuffer:64*1024*1024}).trim();
export const SOURCE_PATHSPEC=['.',`:(exclude)${LAB_PREFIX}`],LAB_PATHSPEC=[LAB_PREFIX];
export const sourceCommit=(root)=>git(root,'log','-1','--format=%H','--',...SOURCE_PATHSPEC);
export const labCommit=(root)=>git(root,'log','-1','--format=%H','--',...LAB_PATHSPEC);
export const sourceDirty=(root)=>git(root,'status','--porcelain','--untracked-files=all','--',...SOURCE_PATHSPEC);
export const labDirty=(root)=>git(root,'status','--porcelain','--untracked-files=all','--',...LAB_PATHSPEC);
// The Lab named by --lab: apps/lab of this repository is read by path; any other directory is a standalone checkout and keeps its own HEAD and status.
// Compared by real path: robot/lab (a symlink to apps/lab) or a trailing slash is still this repository's Lab.
export const realPath=(p)=>{try{return realpathSync(p);}catch{return resolve(p);}};
export const labIdentity=(root,labDir)=>realPath(labDir)===realPath(join(root,LAB_PREFIX))
  ?{commit:labCommit(root),dirty:labDirty(root).length>0}
  :{commit:git(labDir,'rev-parse','HEAD'),dirty:git(labDir,'status','--porcelain','--untracked-files=all').length>0};
// A file of the Lab at a commit: a commit from after the merge has it under apps/lab, one from before it (a standalone Lab SHA) at the repository root.
// Only a missing path falls back; any other Git failure (timeout, unknown commit) is raised as it is.
export const labFileAt=(repo,commit,path)=>{const show=(p)=>execFileSync('git',['show',`${commit}:${p}`],{cwd:repo,timeout:10000,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe'],env:{...process.env,LC_ALL:'C'}});
 try{return show(`${LAB_PREFIX}/${path}`);}catch(e){if(!/does not exist in|exists on disk, but not in/.test(String(e.stderr??'')))throw e;return show(path);}};
