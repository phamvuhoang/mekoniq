import {expect,test} from 'vitest';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadCatalog} from '../../packages/lab-runtime/src/engineering/catalog';
import {validateElectricalDesign,validateSafetyRequirements,validateWiringPolicy,type ElectricalDesignV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {admitElectricalDesign,safetyEvidenceStatus} from '../../packages/lab-runtime/src/engineering/electrical/design';
import {deviceEvidenceLevel} from '../../packages/lab-runtime/src/engineering/electrical/profiles';
// @ts-expect-error TypeScript script, imported for its exported generator
import {generateElectricalFixture} from '../../scripts/generate-electrical-fixture.mts';

const OPTIONS=['serve-hw-a-v1','serve-hw-b-v1','serve-hw-c-v1'] as const;
const read=async(name:string)=>JSON.parse(await readFile(join('robotics/catalog/electrical',name),'utf8'));
const files=async(dir:string)=>Object.fromEntries(await Promise.all((await readdir(dir)).sort().map(async n=>[n,await readFile(join(dir,n),'utf8')])));

test('the generator is deterministic and the committed files are its output',async()=>{
 const a=await mkdtemp(join(tmpdir(),'elec-a-')),b=await mkdtemp(join(tmpdir(),'elec-b-'));
 try{await generateElectricalFixture(a);await generateElectricalFixture(b);expect(await files(a)).toEqual(await files(b));expect(await files(a)).toEqual(await files('robotics/catalog/electrical'));}
 finally{await rm(a,{recursive:true,force:true});await rm(b,{recursive:true,force:true});}
});
test('the manifest lists every other file with its sha256',async()=>{
 const m=await read('manifest.json');
 for(const f of m.files)expect(createHash('sha256').update(await readFile(join('robotics/catalog/electrical',f.path))).digest('hex')).toBe(f.sha256);
 expect(m.files.map((f:{path:string})=>f.path)).toEqual([...(await readdir('robotics/catalog/electrical')).filter(n=>n!=='manifest.json')].sort());
});
test('every design, the policy and the safety register validate and every named profile is in the catalog',async()=>{
 const c=await loadCatalog('robotics/catalog'),byDigest=new Set(Object.keys(c.deviceProfiles));
 expect(validateWiringPolicy(await read('wiring-policy-v1.json')).problems).toEqual([]);
 expect(validateSafetyRequirements(await read('serve-safety-requirements-v1.json')).problems).toEqual([]);
 for(const o of OPTIONS){
  const d=await read(`${o}.json`) as ElectricalDesignV1;
  expect(validateElectricalDesign(d).problems,o).toEqual([]);
  for(const dev of d.devices)expect(byDigest.has(dev.profile.digest),`${o}/${dev.id}`).toBe(true);
 }
});
test('the three options carry the same signal ids and refer to the Serve tray project',async()=>{
 const project=JSON.parse(await readFile('robotics/simulation-mujoco/fixtures/serve-tray-v1/serve-3d-project.json','utf8'));
 const ds=await Promise.all(OPTIONS.map(o=>read(`${o}.json`) as Promise<ElectricalDesignV1>));
 const ids=ds.map(d=>d.signals.map(s=>s.id).sort());
 expect(ids[1]).toEqual(ids[0]);expect(ids[2]).toEqual(ids[0]);
 for(const d of ds){expect(d.project).toEqual({id:project.id,revision:project.revision});expect(d.signals.filter(s=>s.consumer==='safety_chain').every(s=>s.pinned===null)).toBe(true);}
});
test('HW-B has no torque-off drive, so its emergency stop names a requirement that uses the contactor and the safety relay',async()=>{
 const b=await read('serve-hw-b-v1.json') as ElectricalDesignV1,reg=await read('serve-safety-requirements-v1.json');
 const emergency=b.stopFunctions.find(f=>f.id==='emergency')!,req=reg.requirements.find((r:{id:string})=>r.id===emergency.requirementId);
 expect(req.deviceIds).toEqual(expect.arrayContaining(['contactor','safety-relay']));
 expect((await loadCatalog('robotics/catalog')).deviceProfiles).toBeDefined();
});
test('the options are admitted against the shipped catalog and the profile levels are what the documents allow',async()=>{
 const c=await loadCatalog('robotics/catalog');
 for(const o of OPTIONS){
  const d=await read(`${o}.json`) as ElectricalDesignV1,project={id:d.project.id,revision:d.project.revision,digest:'0'.repeat(64)};
  const r=admitElectricalDesign(d,{resolved:{placements:[],bom:{lines:[]}} as never,project,deviceProfiles:c.deviceProfiles,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right']});
  expect(r.problems,o).toEqual([]);
 }
 const by=Object.fromEntries(Object.values(c.deviceProfiles).map(p=>[p.id,p]));
 expect(deviceEvidenceLevel(by['blvd-krd-v1']!).level).toBe('candidate');
 expect(deviceEvidenceLevel(by['zlac8015d-v1']!).missing).toContain('ASSUMED_SOURCE');
 expect(by['zlac8015d-v1']!.drive!.stop.torqueOff).toBeNull();
 const reg=await read('serve-safety-requirements-v1.json');
 expect(reg.requirements.map((r:never)=>safetyEvidenceStatus(r))).toEqual(['open','open']);
});
