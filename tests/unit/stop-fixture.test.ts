import {expect,test} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateDriveModel,driveDocumentDigest,type ControlProfileV1,type DriveModelV1} from '../../packages/lab-runtime/src/v2/control/drive-io';
// @ts-expect-error TypeScript script, imported for its exported generator
import {generateStopFixture} from '../../scripts/generate-stop-fixture.mts';

const DIR='robotics/simulation-mujoco/fixtures/stop-v1';
const files=async(dir:string)=>Object.fromEntries(await Promise.all((await readdir(dir)).sort().map(async n=>[n,await readFile(join(dir,n),'utf8')])));
const doc=async<T>(n:string)=>JSON.parse(await readFile(join(DIR,n),'utf8')) as T;

test('the generator reproduces the committed fixture byte for byte',async()=>{
 const d=await mkdtemp(join(tmpdir(),'stop-fx-'));
 try{await generateStopFixture(d);expect(await files(d)).toEqual(await files(DIR));}finally{await rm(d,{recursive:true,force:true});}
});
test('the manifest hashes every file',async()=>{
 const m=await doc<{files:{path:string;sha256:string}[]}>('manifest.json');
 for(const f of m.files)expect(createHash('sha256').update(await readFile(join(DIR,f.path))).digest('hex')).toBe(f.sha256);
});
test('brake and coast differ in exactly onDisable and brakeTorqueNm; both are valid revisions above the R4 model',async()=>{
 const brake=await doc<DriveModelV1>('serve-drive-hw-c-brake-v1.json'),coast=await doc<DriveModelV1>('serve-drive-hw-c-coast-v1.json'),r4=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/drive-v1/serve-drive-nominal-v1.json','utf8')) as DriveModelV1;
 for(const m of [brake,coast]){expect(validateDriveModel(m).ok).toBe(true);expect(driveDocumentDigest(m)).toBe(m.digest);expect(m.calibration).toBe('not_calibrated');}
 const diff=brake.axes.flatMap((a,i)=>(Object.keys(a) as (keyof typeof a)[]).filter(k=>JSON.stringify(a[k])!==JSON.stringify(coast.axes[i]![k])));
 expect([...new Set(diff)].sort()).toEqual(['brakeTorqueNm','onDisable']);
 expect(brake.axes.every(a=>a.onDisable==='brake'&&a.brakeTorqueNm!==null)).toBe(true);expect(coast.axes.every(a=>a.onDisable==='coast'&&a.brakeTorqueNm===null)).toBe(true);
 expect(brake.revision).toBe(1);expect(r4.sources).toEqual(brake.sources);
});
test('the control profile carries the documented acceleration and both drive models',async()=>{
 const c=await doc<ControlProfileV1>('serve-control-hw-c-v1.json'),brake=await doc<DriveModelV1>('serve-drive-hw-c-brake-v1.json'),coast=await doc<DriveModelV1>('serve-drive-hw-c-coast-v1.json');
 expect(c.driveModelDigests).toEqual([brake.digest,coast.digest]);expect(c.axes.every(a=>a.accelerationLimit!==null&&a.accelerationLimit>100)).toBe(true);expect(driveDocumentDigest(c)).toBe(c.digest);
});
