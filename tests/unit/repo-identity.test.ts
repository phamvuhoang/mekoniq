import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
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
  expect(g('apps/lab','packages','robotics',':(exclude)*.md')).toBe('');
  expect(g('from [\'"](\\.\\./){2,}(packages|scripts|tests|robotics)','apps/lab/src')).toBe('');
});

test('labIdentity reads apps/lab by path and any other directory as a standalone checkout',()=>{
  const d=repo();put(d,'README.md','a');put(d,'apps/lab/x','a');const A=commit(d,'a');put(d,'README.md','b');const B=commit(d,'b');
  expect(labIdentity(d,join(d,'apps/lab'))).toEqual({commit:A,dirty:false});
  const solo=repo();put(solo,'f','1');const S=commit(solo,'s');put(solo,'g','2');
  expect(labIdentity(d,solo)).toEqual({commit:S,dirty:true});expect(B).not.toBe(A);
  // robot/lab is a symlink to apps/lab; it and a trailing slash still name this repository's Lab (HEAD is B, the Lab commit A)
  const link=join(mkdtempSync(join(tmpdir(),'repo-identity-link-')),'lab');symlinkSync(join(d,'apps/lab'),link);
  expect(labIdentity(d,link)).toEqual({commit:A,dirty:false});expect(labIdentity(d,join(d,'apps/lab')+'/')).toEqual({commit:A,dirty:false});
});

test('labFileAt reads a Lab file from a commit before the merge (root) and after it (apps/lab)',()=>{
  const d=repo();put(d,'config/pin.json','old');const OLD=commit(d,'standalone lab');
  sh(d,'rm','-q','-r','config');put(d,'apps/lab/config/pin.json','new');const NEW=commit(d,'moved');
  expect(labFileAt(d,OLD,'config/pin.json').toString()).toBe('old');expect(labFileAt(d,NEW,'config/pin.json').toString()).toBe('new');
  expect(()=>labFileAt(d,NEW,'config/missing.json')).toThrow();
  // a failure other than a missing path is not retried at the root
  expect(()=>labFileAt(d,'no-such-ref','config/pin.json')).toThrow(/apps\/lab\/config\/pin\.json/);
});

// Recorders and readbacks bind the source side by path (repo-identity sourceCommit). A script that records HEAD as the source commit
// mismatches them as soon as a pin commit sits on top. Every HEAD reader left is listed with its reason.
test('no new HEAD reader stands in for the source commit',()=>{
  const allowed={
    'packages/lab-runtime/src/v2/sil/native-providers.ts':'pinned runtime; a native host checks out the source commit itself',
    'packages/lab-runtime/src/v2/sil/xarm-cli.ts':'pinned runtime; same',
    'scripts/lab-sil.mjs':'feeds native-providers.ts, which checks HEAD',
    'scripts/lab-algorithm.mjs':'checker identity of the checkout, recorded beside the subject commit',
    'scripts/export-arm-controller.mjs':'arm-controller package version',
    'scripts/r4-cld02.sh':'native CI container, runs on the source commit before the pin commit',
    'scripts/r5-cld05.sh':'native CI container; refuses unless HEAD is the path-based source commit',
    'scripts/repo-identity.mjs':'standalone Lab checkout',
    'scripts/release.mjs':'platform release, no Lab pair',
    'scripts/restore-rehearsal.mjs':'platform release, no Lab pair',
    'tests/support/load-report.ts':'platform load report, no Lab pair',
    'tests/support/regression-identity.ts':'standalone Lab checkout',
  };
  let hits='';try{hits=execFileSync('git',['grep','-lE',"rev-parse(' *, *'| )HEAD",'--','scripts','packages','tests/support','deploy','apps/lab/scripts'],{encoding:'utf8'}).trim();}catch{/* none */}
  expect(hits.split('\n').filter(Boolean).filter(f=>!(f in allowed))).toEqual([]);
});
