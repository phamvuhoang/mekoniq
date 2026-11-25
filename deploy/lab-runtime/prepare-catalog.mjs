// Materialize only the committed portable mobile catalog. No Python/native compiler closure is needed.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const [fixture,root,electrical]=process.argv.slice(2);
if(!fixture||!root)throw Error('usage: prepare-catalog.mjs <components.json> <output> [<robotics/catalog without documents>]');
const {components,models}=JSON.parse(await readFile(fixture,'utf8'));
await mkdir(join(root,'components'),{recursive:true});await mkdir(join(root,'models'),{recursive:true});
const entries=[];
for(const [digest,component]of Object.entries(components)){
 if(component.documents.length)throw Error('PORTABLE_CATALOG_DOCUMENT_CLOSURE_REQUIRED');
 const file=`components/${digest}.json`;await writeFile(join(root,file),JSON.stringify(component));entries.push({digest,file});
}
for(const [digest,model]of Object.entries(models))await writeFile(join(root,'models',`${digest}.json`),JSON.stringify(model));
// R5: with the electrical catalog the image also holds the device profiles, the electrical fixtures and the parts the profiles name (digest-checked at load); no manufacturer document is copied.
let extra={};
if(electrical){
 const all=JSON.parse(await readFile(join(electrical,'catalog.json'),'utf8')),have=new Set(entries.map(e=>e.digest));
 for(const d of ['components','models','devices','electrical'])await cp(join(electrical,d),join(root,d),{recursive:true,force:false,errorOnExist:false});
 for(const e of all.components??[])if(!have.has(e.digest))entries.push(e);
 extra={deviceProfiles:all.deviceProfiles??[]};
}
await writeFile(join(root,'catalog.json'),JSON.stringify({schemaVersion:1,id:'mujoco-mobile-portable',components:entries,quotes:[],...extra}));
