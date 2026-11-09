// C03: every pinned package of each portable worker lock has a license entry in the tool root's licenses.json (shipped inside the portable closure), and the
// inventory names the venv it was read from. A pin without a license row, or a row for nothing pinned, is a release-inventory defect.
import {expect,test} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
// @ts-expect-error plain ESM script without types
import {PORTABLE_TOOLS,licenseInventory,pinsOf} from '../../scripts/portable-licenses.mjs';
test('portable-licenses: the committed licenses.json of each worker names exactly the lock pins, with a license for each',()=>{
 for(const tool of PORTABLE_TOOLS as {root:string;lock:string;python:string}[]){
  const file=resolve(tool.root,'licenses.json');
  expect(existsSync(file),file).toBe(true);
  const inv=JSON.parse(readFileSync(file,'utf8')) as {schemaVersion:number;documentType:string;lock:{path:string;sha256:string};packages:{name:string;version:string;license:string;source:string}[]};
  expect(inv).toMatchObject({schemaVersion:1,documentType:'portable-license-inventory',lock:{path:tool.lock}});
  const pins=pinsOf(readFileSync(resolve(tool.lock),'utf8')) as [string,string][];
  expect(inv.packages.map(p=>[p.name,p.version]).sort()).toEqual([...pins].sort());
  for(const p of inv.packages)expect(p.license,p.name).toMatch(/\S/);
 }
});
test.skipIf(!existsSync(resolve('.venv-irsim/bin/python')))('portable-licenses: the inventory read from the pinned venv now equals the committed one (nothing was edited by hand)',async()=>{
 for(const tool of PORTABLE_TOOLS as {root:string}[]){const live=await licenseInventory(tool);expect(live).toEqual(JSON.parse(readFileSync(resolve(tool.root,'licenses.json'),'utf8')));}
},60_000);
