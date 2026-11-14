// Materialize only the committed portable mobile catalog. No Python/native compiler closure is needed.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [fixture,root]=process.argv.slice(2);
if(!fixture||!root)throw Error('usage: prepare-catalog.mjs <components.json> <output>');
const {components,models}=JSON.parse(await readFile(fixture,'utf8'));
await mkdir(join(root,'components'),{recursive:true});await mkdir(join(root,'models'),{recursive:true});
const entries=[];
for(const [digest,component]of Object.entries(components)){
 if(component.documents.length)throw Error('PORTABLE_CATALOG_DOCUMENT_CLOSURE_REQUIRED');
 const file=`components/${digest}.json`;await writeFile(join(root,file),JSON.stringify(component));entries.push({digest,file});
}
for(const [digest,model]of Object.entries(models))await writeFile(join(root,'models',`${digest}.json`),JSON.stringify(model));
await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,id:'mujoco-mobile-portable',components:entries,quotes:[]}));
