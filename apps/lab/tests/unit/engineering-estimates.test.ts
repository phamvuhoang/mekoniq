import {expect,test} from 'vitest';
import {engineeringEstimateInputs} from '../../src/design/engineering-estimates';
import {estimateDrive} from '../../src/estimates/drive';
import {makeEngineeringArchive} from '../support/engineering';
import {sha256Hex} from '../../src/twin/hash';
import {componentDigest} from '../../src/project/engineering-archive';

test('drive inputs come from the design: wheel radius, ratio, efficiency and total AMR mass',()=>{
  const archive=makeEngineeringArchive(),r=engineeringEstimateInputs(archive.manifest.project,archive);
  expect(r.drive).toMatchObject({wheelRadiusM:0.1,drivenWheels:2,gearRatio:10,gearEfficiency:0.8});
  expect(r.drive!.massKg).toBeCloseTo(20+2*(0.2+1.5)+6+1.2,9);
  expect(r.drive!.peakMotorTorqueNm).toBeCloseTo(3/(10*0.8),9);
  const est=estimateDrive({...r.drive!,accelerationMps2:0.5,rollingResistance:0.02,slopeRadians:0});
  expect(est!.continuousTorqueStatus).toBe('missing');   // no continuous rating is stated, so none is assumed
  expect(est!.wheelTorqueNm).toBeCloseTo((r.drive!.massKg*0.5+0.02*r.drive!.massKg*9.81)*0.1/2,9);
});
test('a change in the design changes the inputs, with no preset values behind it',()=>{
  const archive=makeEngineeringArchive();
  const heavier=structuredClone(archive);
  heavier.manifest.components.find(c=>c.id==='amr-chassis')!.links[0]!.massKg.value=25;
  heavier.manifest.project.assembly.instances.forEach(()=>{});
  const before=engineeringEstimateInputs(archive.manifest.project,archive).drive!.massKg;
  const after=engineeringEstimateInputs(heavier.manifest.project,heavier);
  // the edited component has a new digest, so the instance no longer resolves: reported, not silently the old mass
  expect(after.problems.map(p=>p.code)).toContain('COMPONENT_MISSING');
  expect(before).toBeGreaterThan(0);
});
test('missing model blob, capacity and support polygon are reported and nothing is borrowed',()=>{
  const draft=makeEngineeringArchive({omitBlobs:true}),r=engineeringEstimateInputs(draft.manifest.project,draft);
  expect(r.drive).toBeNull();
  expect(r.problems.map(p=>p.code)).toEqual(expect.arrayContaining(['MODEL_BLOB_MISSING','DRIVE_MODEL_UNAVAILABLE','ENERGY_CAPACITY_UNAVAILABLE','STABILITY_UNAVAILABLE']));
  expect(r.stability).toBeNull();
  expect(r.energy).toEqual({volts:25.5});
});

test('a model blob that is not a valid model gives a problem and no drive estimate, never an exception', () => {
  const archive=makeEngineeringArchive();
  const modelFile=Object.keys(archive.files).find(f=>archive.manifest.blobs.find(b=>b.file===f)!.mediaType==='application/json')!;
  const bytes=new TextEncoder().encode('not json'),digest=sha256Hex(bytes);
  const broken=structuredClone(archive);
  // keep the archive self-consistent: re-point the chassis at a blob whose hash really is the garbage bytes
  const chassis=broken.manifest.components.find(c=>c.id==='amr-chassis')!;
  const before=componentDigest(chassis);
  chassis.models[0]!.digest=digest;
  for (const i of broken.manifest.project.assembly.instances) if (i.componentDigest===before) i.componentDigest=componentDigest(chassis);
  delete broken.files[modelFile];broken.files[`blobs/${digest}`]=bytes;
  const r=engineeringEstimateInputs(broken.manifest.project,broken);
  expect(r.drive).toBeNull();
  expect(r.problems.map(p=>p.code)).toContain('MODEL_INVALID');
  const shapeless=structuredClone(archive);shapeless.files[modelFile]=new TextEncoder().encode('{"transmission":{}}');
  expect(()=>engineeringEstimateInputs(shapeless.manifest.project,shapeless)).not.toThrow();
});
test('without every bound component the AMR mass is unknown, so there is no drive estimate', () => {
  const archive=makeEngineeringArchive(),battery=archive.manifest.components.find(c=>c.id==='battery-24v')!;
  const partial=structuredClone(archive);
  partial.manifest.components=partial.manifest.components.filter(c=>c.id!==battery.id);
  const r=engineeringEstimateInputs(partial.manifest.project,partial);
  expect(r.drive).toBeNull();
  expect(r.problems.map(p=>p.code)).toEqual(expect.arrayContaining(['COMPONENT_MISSING','DRIVE_MASS_INCOMPLETE']));
});

function withBattery(battery:unknown) {
  const archive=makeEngineeringArchive(),old=archive.manifest.components.find(c=>c.id==='battery-24v')!,oldDigest=componentDigest(old);
  const rated={...old,battery} as typeof old;
  archive.manifest.components[archive.manifest.components.indexOf(old)]=rated;
  for (const i of archive.manifest.project.assembly.instances) if (i.componentDigest===oldDigest) i.componentDigest=componentDigest(rated);
  return archive;
}
const assumedSource={kind:'assumed',documentId:'fixture',revision:'1',locator:'x',contentSha256:'a'.repeat(64)};
test('a catalog battery rating supplies capacity and usable fraction, and the capacity warning goes away',()=>{
  const archive=withBattery({portId:'out',capacityAh:{value:20,unit:'Ah',source:assumedSource},usableFraction:{value:0.8,unit:'1',source:assumedSource}});
  const r=engineeringEstimateInputs(archive.manifest.project,archive);
  expect(r.energy).toEqual({volts:25.5,ampHours:20,usable:0.8});
  expect(r.problems.map(p=>p.code)).not.toContain('ENERGY_CAPACITY_UNAVAILABLE');
  expect(r.problems.map(p=>p.code)).toContain('STABILITY_UNAVAILABLE'); // placement still needs the compiled bundle
});
test('a battery rating on a port that is not the supplying one is not used',()=>{
  const archive=withBattery({portId:'mount',capacityAh:{value:20,unit:'Ah',source:assumedSource},usableFraction:{value:0.8,unit:'1',source:assumedSource}});
  const r=engineeringEstimateInputs(archive.manifest.project,archive);
  expect(r.energy).toEqual({volts:25.5});
  expect(r.problems.map(p=>p.code)).toContain('ENERGY_CAPACITY_UNAVAILABLE');
});

test('the estimate summary shows mass and nominal usable energy when the design states them, and the missing inputs when it does not',async()=>{
  const {estimateSummary}=await import('../../src/design/engineering-estimates');
  const rated=withBattery({portId:'out',capacityAh:{value:20,unit:'Ah',source:assumedSource},usableFraction:{value:0.8,unit:'1',source:assumedSource}});
  const s=estimateSummary(rated.manifest.project,rated);
  expect(s.massKg).toBeCloseTo(20+2*(0.2+1.5)+6+1.2,9);
  expect(s.nominalUsableWh).toBeCloseTo(25.5*20*0.8,9);
  expect(s.missing.map(m=>m.code)).not.toContain('ENERGY_CAPACITY_UNAVAILABLE');
  const bare=makeEngineeringArchive(),b=estimateSummary(bare.manifest.project,bare);
  expect(b.nominalUsableWh).toBeNull();                       // never a number the design did not state
  expect(b.missing.map(m=>m.code)).toContain('ENERGY_CAPACITY_UNAVAILABLE');
});
