import {expect,test} from 'vitest';
import Ajv from 'ajv';
import schema from '../../packages/contracts/schemas/physical-target-dossier-v1.schema.json';
import {assessTargetDossier} from '../../packages/lab-runtime/src/commissioning/target-dossier';
import {preparedDossierFixture,undecidedDossierFixture,prerequisiteFields} from '../fixtures/physical-target-dossier';
const validate=new Ajv({strict:true,allErrors:true}).compile(schema);
test('undecided is a valid incomplete dossier with both independent arm prerequisites',()=>{
 const dossier=undecidedDossierFixture(),result=assessTargetDossier(dossier);
 expect(validate(dossier),JSON.stringify(validate.errors)).toBe(true);
 expect(result.structurallyValid).toBe(true);expect(result.readiness).toBe('incomplete');
 expect(result.missing).toContain('targetKind');
 expect(result.branchRequirements.map(x=>x.branch)).toEqual(['xarm_ros2','custom_linuxcnc']);
 expect(result.branchRequirements[0].requirements).toContain('vendor hardware driver and physical identity');
 expect(result.branchRequirements[1].requirements).toContain('measured machine kinematics and controller/drive interface');
});
test.each(['xarm_ros2','custom_linuxcnc'] as const)('sourced %s references prepare documents without creating approval',branch=>{
 const dossier=preparedDossierFixture(branch),before=structuredClone(dossier),result=assessTargetDossier(dossier);
 expect(validate(dossier),JSON.stringify(validate.errors)).toBe(true);
 expect(result).toMatchObject({structurallyValid:true,readiness:'prepared',missing:[]});
 expect(result.branchRequirements.map(x=>x.branch)).toEqual([branch]);
 expect(Object.keys(result).sort()).toEqual(['branchRequirements','missing','readiness','structurallyValid']);
 expect(dossier).toEqual(before);
});
test.each(['vendor','model','firmware','sdk','serial'])('unknown %s cannot prepare a selected target',field=>{
 const dossier=preparedDossierFixture();
 for(const value of [null,{value:'unknown',sourceKind:'vendor' as const,sourceRef:'ref',owner:'owner'},{value:' TBD ',sourceKind:'vendor' as const,sourceRef:'ref',owner:'owner'}]) {
  dossier.identity[field]=value;
  expect(assessTargetDossier(dossier)).toMatchObject({readiness:'incomplete',missing:expect.arrayContaining([`identity.${field}`])});
 }
});
test.each(prerequisiteFields)('missing %s stays incomplete',field=>{
 const dossier=preparedDossierFixture();dossier.prerequisites[field]=null;
 expect(assessTargetDossier(dossier)).toMatchObject({structurallyValid:true,readiness:'incomplete',missing:expect.arrayContaining([`prerequisites.${field}`])});
});
test('calibration and latency require measured sources and complete source ownership',()=>{
 for(const field of ['calibration','latency']) {
  const dossier=preparedDossierFixture();dossier.prerequisites[field]!.sourceKind='vendor';
  expect(validate(dossier)).toBe(false);expect(assessTargetDossier(dossier).readiness).toBe('incomplete');
 }
 for(const field of ['owner','sourceRef','value']) {
  const dossier=preparedDossierFixture();Object.assign(dossier.identity.serial!,{[field]:' '});
  expect(validate(dossier)).toBe(false);expect(assessTargetDossier(dossier).structurallyValid).toBe(false);
 }
});
test('chassis uses its existing profile namespace; arm and simulation profiles cannot substitute',()=>{
 const dossier={...preparedDossierFixture(),targetKind:'chassis',branch:null,profileId:'wheeltec-s100'};
 expect(assessTargetDossier(dossier)).toMatchObject({structurallyValid:true,readiness:'prepared',branchRequirements:[]});
 for(const invalid of [{...dossier,profileId:'arm-xarm-dossier-v1'},{...preparedDossierFixture(),profileId:'wheeltec-s100'},{...preparedDossierFixture(),profileId:'xarm6-jazzy-sim'},{...preparedDossierFixture(),branch:'custom_linuxcnc'}]) {
  expect(validate(invalid)).toBe(false);expect(assessTargetDossier(invalid).structurallyValid).toBe(false);
 }
});
test.each([null,[],{}, {...undecidedDossierFixture(),schemaVersion:2},{...preparedDossierFixture(),live:true},{...preparedDossierFixture(),signature:{value:'pretend'}},{...preparedDossierFixture(),registers:[1]}])('malformed or authority-bearing input is refused: %j',value=>{
 expect(validate(value)).toBe(false);expect(assessTargetDossier(value)).toMatchObject({structurallyValid:false,readiness:'incomplete',missing:expect.arrayContaining(['schema'])});
});
