// Snapshots the shipped reference catalog and the FD01 reference project for the Lab's offline design page:
//   pnpm exec tsx scripts/export-engineering-reference.ts <out.json>
// The Lab never reads the source checkout at run time; this file is data, verified by digest on load.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadCatalog} from '../packages/lab-runtime/src/engineering/catalog';
const out=process.argv[2];
if(!out)throw new Error('usage: export-engineering-reference.ts <out.json>');
const catalog=await loadCatalog(resolve('robotics/catalog'));
if(catalog.problems.some(p=>p.blocking))throw new Error(`CATALOG_PROBLEMS: ${catalog.problems.filter(p=>p.blocking).map(p=>p.code).join(',')}`);
const project=JSON.parse(await readFile('tests/fixtures/engineering/fd01.project.json','utf8'));
await writeFile(out,JSON.stringify({schemaVersion:1,note:'Snapshot of source robotics/catalog; every component is a candidate, parameters are assumed unless a document says otherwise.',components:catalog.components,models:catalog.models,quotes:catalog.quotes,project},null,1)+'\n',{flag:'wx'});
console.log(`wrote ${out}: ${Object.keys(catalog.components).length} components, ${Object.keys(catalog.models).length} models`);
