import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {sourceCommit,labCommit,sourceDirty,labDirty,labIdentity,labFileAt} from '../../scripts/repo-identity.mjs';

const sh=(cwd:string,...a:string[])=>execFileSync('git',a,{cwd,encoding:'utf8'}).trim();
const repo=()=>{const d=mkdtempSync(join(tmpdir(),'repo-identity-'));sh(d,'init','-q','-b','main');sh(d,'config','user.email','t@t');sh(d,'config','user.name','t');sh(d,'config','commit.gpgsign','false');return d;};
const put=(d:string,f:string,t:string)=>{mkdirSync(join(d,f,'..'),{recursive:true});writeFileSync(join(d,f),t);};
const commit=(d:string,m:string)=>{sh(d,'add','-A');sh(d,'commit','-q','-m',m);return sh(d,'rev-parse','HEAD');};

test('MG-03 source and Lab commits follow the paths a commit touches',()=>{
  const d=repo();put(d,'README.md','a');const A=commit(d,'a');
  put(d,'apps/lab/x','b');const B=commit(d,'b');
  expect(sourceCommit(d)).toBe(A);expect(labCommit(d)).toBe(B);
  put(d,'README.md','c');put(d,'apps/lab/x','c');const C=commit(d,'c');
  expect(sourceCommit(d)).toBe(C);expect(labCommit(d)).toBe(C);
});

test('MG-03 dirty is per side and untracked files count',()=>{
  const d=repo();put(d,'README.md','a');put(d,'apps/lab/x','a');commit(d,'a');
  expect(sourceDirty(d)).toBe('');expect(labDirty(d)).toBe('');
  put(d,'README.md','changed');expect(sourceDirty(d)).not.toBe('');expect(labDirty(d)).toBe('');
  sh(d,'checkout','--','README.md');put(d,'apps/lab/new.ts','n');expect(labDirty(d)).not.toBe('');expect(sourceDirty(d)).toBe('');
  put(d,'src/new.ts','n');expect(sourceDirty(d)).not.toBe('');
});

test('MG-03 a Lab-only branch merged with --no-ff leaves the source commit where it was',()=>{
  const d=repo();put(d,'README.md','a');const A=commit(d,'a');
  sh(d,'checkout','-q','-b','side');put(d,'apps/lab/y','y');commit(d,'y');sh(d,'checkout','-q','main');
  put(d,'apps/lab/z','z');commit(d,'z');sh(d,'merge','-q','--no-ff','side','-m','merge');
  expect(sourceCommit(d)).toBe(A);expect(labCommit(d)).not.toBe(A);
});

test('MG-10 import boundaries: runtime never imports the Lab, the Lab web code never reaches out of apps/lab',()=>{
  const g=(re:string,...p:string[])=>{try{return execFileSync('git',['grep','-nE',re,'--',...p],{encoding:'utf8'}).trim();}catch{return '';}};
  expect(g('apps/lab','packages','robotics')).toBe('');
  expect(g('from [\'"](\\.\\./){2,}(packages|scripts|tests|robotics)','apps/lab/src')).toBe('');
});

test('labIdentity reads apps/lab by path and any other directory as a standalone checkout',()=>{
  const d=repo();put(d,'README.md','a');put(d,'apps/lab/x','a');const A=commit(d,'a');put(d,'README.md','b');const B=commit(d,'b');
  expect(labIdentity(d,join(d,'apps/lab'))).toEqual({commit:A,dirty:false});
  const solo=repo();put(solo,'f','1');const S=commit(solo,'s');put(solo,'g','2');
  expect(labIdentity(d,solo)).toEqual({commit:S,dirty:true});expect(B).not.toBe(A);
});

test('labFileAt reads a Lab file from a commit before the merge (root) and after it (apps/lab)',()=>{
  const d=repo();put(d,'config/pin.json','old');const OLD=commit(d,'standalone lab');
  sh(d,'rm','-q','-r','config');put(d,'apps/lab/config/pin.json','new');const NEW=commit(d,'moved');
  expect(labFileAt(d,OLD,'config/pin.json').toString()).toBe('old');expect(labFileAt(d,NEW,'config/pin.json').toString()).toBe('new');
  expect(()=>labFileAt(d,NEW,'config/missing.json')).toThrow();
});
