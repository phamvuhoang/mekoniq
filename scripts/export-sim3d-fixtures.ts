// Writes the reviewed serve-3d-v1 fixture files and a hashed manifest:
//   pnpm exec tsx scripts/export-sim3d-fixtures.ts
// robotics/simulation-3d/fixtures/serve-3d-v1 is what the Python compiler tests and the portable tool manifest read. serve-demo-v1 (IR-SIM) is never written by this script.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {exportedFixtureFiles3d} from '../tests/support/navigation2d';

const dir='robotics/simulation-3d/fixtures/serve-3d-v1';
const files=Object.entries(exportedFixtureFiles3d()).map(([name,content])=>({name,text:JSON.stringify(content,null,2)+'\n'}));
const manifest={schemaVersion:1,documentType:'sim3d-fixture-manifest',id:'serve-3d-v1',generator:'scripts/export-sim3d-fixtures.ts',
 note:'Serve plus two passive ball casters for the 3D plants. Dimensions, masses, caster size and the world3d heights and frictions are assumed inputs; inertia is derived from them. Nothing here is a measured or vendor-locked value.',
 files:files.map(f=>({path:f.name,sha256:createHash('sha256').update(f.text).digest('hex'),bytes:Buffer.byteLength(f.text)}))};
await mkdir(dir,{recursive:true});
for(const f of files)await writeFile(join(dir,f.name),f.text);
await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`wrote ${files.length} fixture files and manifest.json`);
