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
