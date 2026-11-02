#!/usr/bin/env node
// Dry-run / report only. Reads ONE user-exported trial site.json given as the argument; no network, never reads ../trial, writes nothing.
// Applying is the product command Trial.ImportApply (manager), after reviewing this report.
//   node scripts/import-trial-config.mjs <exported-site.json>      exit 0 = ready, 2 = rejected, 1 = usage/IO error
import {readFile} from 'node:fs/promises';
import {register} from 'tsx/esm/api';
const [path,...rest]=process.argv.slice(2);
if(!path||path.startsWith('-')||rest.length){console.error('usage: node scripts/import-trial-config.mjs <exported-site.json>');process.exit(1);}
let input;
try{input=JSON.parse(await readFile(path,'utf8'));}catch(error){console.error(`cannot read ${path}: ${error instanceof Error?error.message:error}`);process.exit(1);}
register();
const {buildTrialImportReport}=await import('../packages/domain/src/configuration/trial-import.ts');
// no venue snapshots here: the report cannot see existing robots/points, so ROBOT_EXISTS / POINT_KIND_CONFLICT / already-applied are only known at Trial.ImportPreview
const {report}=buildTrialImportReport(input,[]);
console.log(JSON.stringify({...report,venueChecks:'not_evaluated_offline',note:'Dry-run only. Nothing was imported. Apply with Trial.ImportApply and the previewHash after the venue preview.'},null,2));
process.exit(report.status==='ready'?0:2);
