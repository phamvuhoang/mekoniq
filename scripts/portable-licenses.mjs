#!/usr/bin/env node
// License inventory of each portable Python worker (C03, LFIR-17): reads the pinned venv's installed distribution metadata and writes <tool root>/licenses.json
// for exactly the `name==version` pins of the tool's requirements.lock (so the inventory and the lock cannot drift apart). The file lives inside the portable
// tool closure the exporter and the Lab importer hash.  node scripts/portable-licenses.mjs [--check]   (--check: exit 1 when a committed inventory differs)
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const PORTABLE_TOOLS=[
 {id:'irsim_worker',root:'robotics/navigation-2d',lock:'robotics/navigation-2d/requirements.lock',python:'.venv-irsim/bin/python'},
 {id:'linkforge_worker',root:'robotics/model-validation',lock:'robotics/model-validation/requirements.lock',python:'.venv-linkforge/bin/python'},
 {id:'algorithm_checks',root:'robotics/algorithm',lock:'robotics/algorithm/requirements.lock',python:'.venv-algorithm/bin/python'},
];
const norm=(n)=>n.toLowerCase().replace(/[_.]/g,'-');
/** `[name, version]` of every `name==version` pin of a requirements.lock (hash lines ignored). */
export const pinsOf=(text)=>[...text.matchAll(/^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s;\\]+)/gm)].map(([,n,v])=>[norm(n),v]);
// stdlib-only probe in isolated mode: License-Expression (PEP 639), else the License field, else the License classifier
const PROBE="import json,importlib.metadata as m\nr={}\nfor d in m.distributions():\n md=d.metadata;c=[x for x in (md.get_all('Classifier') or []) if x.startswith('License ::')]\n e=md.get('License-Expression');l=(md.get('License') or '').strip()\n r[md['Name'].lower().replace('_','-').replace('.','-')]={'version':d.version,'license':e or (l if l and len(l)<=120 and '\\n' not in l else '') or (c[0].split('::')[-1].strip() if c else ''),'source':'License-Expression' if e else 'License' if l and len(l)<=120 and '\\n' not in l else 'Classifier' if c else 'none'}\nprint(json.dumps(r))";
export async function licenseInventory(tool,dir=root){
 const lockText=await readFile(join(dir,tool.lock),'utf8'),pins=pinsOf(lockText);
 const installed=JSON.parse(execFileSync(join(dir,tool.python),['-I','-B','-c',PROBE],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}}));
 const packages=pins.map(([name,version])=>{const d=installed[name];if(!d)throw new Error(`NOT_INSTALLED:${tool.id}:${name}`);if(d.version!==version)throw new Error(`VERSION_MISMATCH:${tool.id}:${name} lock ${version} venv ${d.version}`);
  return {name,version,license:d.license||'UNKNOWN (no metadata)',source:d.source};}).sort((a,b)=>a.name<b.name?-1:1);
 return {schemaVersion:1,documentType:'portable-license-inventory',tool:tool.id,lock:{path:tool.lock,sha256:createHash('sha256').update(lockText).digest('hex')},readFrom:'importlib.metadata of the pinned venv (isolated mode)',packages};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const check=process.argv.includes('--check');let differ=0;
 for(const tool of PORTABLE_TOOLS){
  const file=join(root,tool.root,'licenses.json'),text=JSON.stringify(await licenseInventory(tool),null,1)+'\n';
  const current=await readFile(file,'utf8').catch(()=>null);
  if(check){if(current!==text){differ++;console.error(`LICENSES_STALE: ${tool.root}/licenses.json differs from the pinned venv`);}}
  else{await writeFile(file,text);console.log(`${tool.root}/licenses.json: ${JSON.parse(text).packages.length} packages`);}
 }
 process.exit(differ?1:0);
}
