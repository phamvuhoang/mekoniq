#!/usr/bin/env node
// Builtins-only public launcher. This is a native probe, not an effective-Git-graph qualification attestation.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
// Preserve caller-relative paths before changing the child cwd.
const args=process.argv.slice(2);for(let i=0;i<args.length;i++)if(args[i]==='--out'&&args[i+1])args[i+1]=resolve(args[i+1]);
const r=spawnSync(join(root,'node_modules/.bin/tsx'),[join(root,'packages/lab-runtime/src/v2/sil/xarm-cli.ts'),...args],{cwd:root,stdio:'inherit',timeout:240000,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
process.exit(r.status??2);
