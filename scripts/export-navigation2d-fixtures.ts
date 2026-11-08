// Writes the reviewed Serve/restaurant fixture files and a hashed manifest:
//   pnpm exec tsx scripts/export-navigation2d-fixtures.ts
// tests/fixtures/navigation2d is the source-side copy; robotics/navigation-2d/fixtures/serve-demo-v1 is what Python tests and the portable tool manifest read.
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {exportedFixtureFiles} from '../tests/support/navigation2d';

const files=Object.entries(exportedFixtureFiles()).map(([name,content])=>({name,text:JSON.stringify(content,null,2)+'\n'}));
const manifest={schemaVersion:1,documentType:'navigation2d-fixture-manifest',id:'serve-demo-v1',generator:'scripts/export-navigation2d-fixtures.ts',
 note:'Illustrative geometry. Dimensions, masses, LiDAR cadence and beam count are assumed inputs; inertia is derived from them. Nothing here is a measured or vendor-locked value.',
 files:files.map(f=>({path:f.name,sha256:createHash('sha256').update(f.text).digest('hex'),bytes:Buffer.byteLength(f.text)}))};
for(const dir of ['tests/fixtures/navigation2d','robotics/navigation-2d/fixtures/serve-demo-v1']){
 await mkdir(dir,{recursive:true});
 for(const f of files)await writeFile(join(dir,f.name),f.text);
}
await writeFile('robotics/navigation-2d/fixtures/serve-demo-v1/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`wrote ${files.length} fixture files and manifest.json`);
