// Trusted bootstrap: builtins only; audit before any assessment/reference import.
import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function checkedCheckerIdentity(){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}).trim();
 let sourceCommit,tree;
 try{if(await realpath(git('rev-parse','--show-toplevel'))!==await realpath(root))throw Error('wrong root');sourceCommit=git('log','-1','--format=%H','--','.',':(exclude)apps/lab');if(!/^[a-f0-9]{40}$/.test(sourceCommit)||git('rev-parse','--show-object-format')!=='sha1')throw Error('unsupported Git identity');tree=git('ls-tree','-r','-z','--full-tree','HEAD','--','scripts','packages','robotics','integrations','tests/fixtures','package.json','pnpm-lock.yaml','tsconfig.json','.gitignore');}catch{throw Error('CHECKER_GIT_REQUIRED');}
 if(git('status','--porcelain','--untracked-files=all'))throw Error('CHECKER_CHECKOUT_DIRTY');
 let total=0;const entries=tree.split('\0').filter(Boolean);if(!entries.length||entries.length>20000)throw Error('CHECKER_INPUT_MISMATCH');
 for(const entry of entries){
  const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);if(!match)throw Error('CHECKER_INPUT_MISMATCH');
  const [,mode,expected,path]=match;void mode;const file=resolve(root,path),stat=await lstat(file);
  if(!stat.isFile()||stat.isSymbolicLink()||await realpath(file)!==file||stat.size>64*1024*1024||(total+=stat.size)>256*1024*1024)throw Error('CHECKER_INPUT_MISMATCH');
  const bytes=await readFile(file),actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');if(actual!==expected)throw Error('CHECKER_INPUT_MISMATCH');
 }
 return {sourceCommit,toolSha256:createHash('sha256').update(tree).digest('hex')};
}
export async function checkedCheckerCommit(){return (await checkedCheckerIdentity()).sourceCommit;}
