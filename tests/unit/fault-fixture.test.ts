import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
// @ts-expect-error fixture generator is an executable ESM script
import {generateFaultFixture} from '../../scripts/generate-fault-fixture.mjs';
import {driveDocumentDigest} from '../../packages/lab-runtime/src/v2/control/drive-io';
import {DRIVE_FAULTS} from '../../packages/lab-runtime/src/v2/control/drive-faults';

const FX='robotics/simulation-mujoco/fixtures/fault-v1/';
test('generation is byte deterministic and the committed fixture is what the generator writes',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'fault-fixture-'));
 try{
  await generateFaultFixture(join(dir,'a'));await generateFaultFixture(join(dir,'b'));
  const names=await readdir(join(dir,'a'));expect(names.sort()).toEqual(['README.md','fault-oracle-v1.json','manifest.json']);
  for(const n of names){const a=await readFile(join(dir,'a',n));expect(a.equals(await readFile(join(dir,'b',n))),n).toBe(true);expect(a.equals(await readFile(FX+n)),n).toBe(true);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('the manifest hashes every file and the oracle is sealed, assumed, not calibrated, and names every catalog fault once',async()=>{
 const m=JSON.parse(await readFile(FX+'manifest.json','utf8')) as {files:{path:string;sha256:string;bytes:number}[]};
 for(const f of m.files){const b=await readFile(FX+f.path);expect(createHash('sha256').update(b).digest('hex'),f.path).toBe(f.sha256);expect(b.length).toBe(f.bytes);}
 const o=JSON.parse(await readFile(FX+'fault-oracle-v1.json','utf8')) as {digest:string;calibration:string;source:{kind:string};faults:{faultId:string;required:boolean;detector:string|null;codes:string[];deadlineTicks:number|null}[]};
 expect(driveDocumentDigest(o)).toBe(o.digest);expect(o.calibration).toBe('not_calibrated');expect(o.source.kind).toBe('assumed');
 expect(o.faults.map(f=>f.faultId).sort()).toEqual(Object.keys(DRIVE_FAULTS).sort());
 // a required fault must name a detector, its codes and (but for the arm program's own stop) a deadline; an optional one with no detector names no codes
 for(const f of o.faults){if(f.required){expect(f.detector,f.faultId).not.toBeNull();expect(f.codes.length,f.faultId).toBeGreaterThan(0);}if(f.detector===null)expect(f.codes,f.faultId).toEqual([]);}
});
