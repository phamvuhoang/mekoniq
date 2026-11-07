#!/usr/bin/env node
// node scripts/assess-engineering-calibration.mjs --dataset FILE --prediction FILE --out NEWFILE
// A missing dataset exits 2 (G3 not_run). The output file must not already exist: reports are never overwritten.
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const r=spawnSync(join(root,'node_modules/.bin/tsx'),[join(root,'packages/lab-runtime/src/engineering/calibration-cli.ts'),...process.argv.slice(2)],{stdio:'inherit'});
process.exit(r.status??2);
