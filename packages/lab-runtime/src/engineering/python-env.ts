import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let prefix:string|undefined;
/**
 * Environment for every interpreter that runs a pinned Python tool: no bytecode is written (PYTHONDONTWRITEBYTECODE) and none next to the sources is read
 * (PYTHONPYCACHEPREFIX points at a private empty directory, so Python ignores every `__pycache__` in the tool tree). The tool closure digest binds the
 * source files; this makes those files the code that runs.
 */
export function bytecodeEnv():{PYTHONDONTWRITEBYTECODE:'1';PYTHONPYCACHEPREFIX:string}{
 // ponytail: one empty 0700 directory per process (nothing is ever written into it), left in tmpdir at exit
 prefix??=mkdtempSync(join(tmpdir(),'mekoniq-pycache-'));
 return {PYTHONDONTWRITEBYTECODE:'1',PYTHONPYCACHEPREFIX:prefix};
}
/** Isolated bootstrap: the tool roots go onto sys.path only after `site` has run, so nothing in a tool root is imported by site itself (sitecustomize, usercustomize). */
const BOOT="import sys,runpy\nn=int(sys.argv[1]);sys.path[0:0]=sys.argv[2:2+n];a=sys.argv[2+n:]\nif a[0]=='-m':\n sys.argv=[a[1]]+a[2:];runpy.run_module(a[1],run_name='__main__',alter_sys=True)\nelse:\n sys.argv=a;runpy.run_path(a[0],run_name='__main__')";
/**
 * Interpreter argv for a pinned Python tool. `-I` (isolated: no PYTHON* environment, no user site, neither the working directory nor a script directory on sys.path)
 * stops a planted sitecustomize.py/usercustomize.py in a tool root from running at start-up, which PYTHONPATH would allow; the tool roots are then added explicitly by
 * a fixed bootstrap. `-I` also ignores bytecodeEnv(), so the same rules come back as flags: `-B` (write none) and `-X pycache_prefix` (read none beside the sources).
 * `entry` is `['-m', module, ...args]` or `[script, ...args]`; `args` follow it.
 */
export function isolatedPythonArgs(paths:readonly string[],entry:readonly string[],args:readonly string[]=[]):string[]{
 return ['-I','-B','-X',`pycache_prefix=${bytecodeEnv().PYTHONPYCACHEPREFIX}`,'-X','utf8','-u','-c',BOOT,String(paths.length),...paths,...entry,...args];
}
