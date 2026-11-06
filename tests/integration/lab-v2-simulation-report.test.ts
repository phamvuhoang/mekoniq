// SIM-08: evidence records distinguish business pass (from the journal) from physics not_run; modelled quantities never carry `measured`,
// open-loop never reads as closed-loop, and every cup movement traces to a command/journal/evidence id. Records are schema-valid LabEvidenceV2.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {JsonObject} from '../../packages/contracts/src/index';
import {validateEvidenceV2} from '../../packages/lab-runtime/src/v2/contracts';
import {buildSimulationEvidence} from '../../packages/lab-runtime/src/v2/reports/simulation-evidence';
import {runSilScenario} from '../../packages/lab-runtime/src/v2/sil/campaign';
import {startGazeboBackend} from '../../packages/lab-runtime/src/v2/backends/gazebo-nav2';
import {cleanupRuns,executeCoffee,executeFixture,restaurant} from '../support/lab-v2';
import {FakeWorkerPort,compiledWorld} from '../support/sil-rig';
afterEach(cleanupRuns);
const SCHEMA='c'.repeat(64);
const byId=<T extends {id:string}>(records:T[])=>Object.fromEntries(records.map(r=>[r.id.split(':').pop()!,r])) as Record<string,T>;

test('a mock BV01 report yields a business pass record and physics/closed-loop not_run records, all schema-valid',async()=>{
 const report=await executeCoffee('BV01',{seed:42});
 const {records,issues}=buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'BV01',source:{kind:'mock',report}});
 expect(issues).toEqual([]);
 for(const r of records)expect(validateEvidenceV2(r)).toMatchObject({ok:true});
 const rows=byId(records);
 expect(rows.business).toMatchObject({result:'pass',actualFidelity:'modeled',scenarioId:'BV01',runId:report.manifest.runId,requirementIds:expect.arrayContaining(['BV-01','BV-05']),signer:{id:'lab-runtime',trust:'local_unsigned'}});
 expect(rows.business.inputsManifest).toMatchObject({projectHash:report.manifest.project.hash,sourceCommit:'test-commit',schemaHash:SCHEMA,seed:42,mode:'mock',access:'simulated',backends:['mock_amr','mock_coffee','mock_arm']});
 const passed=Object.fromEntries(rows.business.assertions.map(a=>[a.id,a.passed]));
 expect(passed).toMatchObject({'served-after-handoff':true,'arrival-from-observation':true,'cup-ownership-traceable':true,'recipe-steps-in-order':true,'no-measured-provenance-from-model':true,'espresso-without-ice-or-milk':true});
 expect(rows.physics).toMatchObject({result:'not_run',actualFidelity:'modeled'});
 expect(rows.physics.assertions.map(a=>a.id)).toEqual(['contacts','minSeparationM','physical-stop','sensor-evidence']);
 expect(rows.physics.assertions[0]!.detail).toContain('UNSUPPORTED_FIDELITY');
 expect(rows['arm-closed-loop']).toMatchObject({result:'not_run'});expect(rows['arm-closed-loop'].assertions[0]!.detail).toContain('open_loop');
 expect(rows.business.artifacts).toEqual([{name:'report.json',sha256:expect.stringMatching(/^[0-9a-f]{64}$/)}]);
});

test('a model that claims a measured quantity, or a cup movement without evidence, fails the business record with the offending id',async()=>{
 const report=await executeCoffee('BV01',{seed:42});
 const tampered=structuredClone(report);
 const step=((tampered.coffee!.jobs[0]!.steps as JsonObject[])[0]!.measured as JsonObject);step.provenance='measured';
 const r1=buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'BV01',source:{kind:'mock',report:tampered}});
 const business=byId(r1.records).business!;
 expect(business.result).toBe('fail');
 expect(business.assertions.find(a=>a.id==='no-measured-provenance-from-model')).toMatchObject({passed:false,detail:expect.stringContaining(String(tampered.coffee!.jobs[0]!.jobId))});
 const cut=structuredClone(report);
 delete (cut.coffee!.cups[0]!.movements[0] as unknown as JsonObject).evidence;
 const r2=buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'BV01',source:{kind:'mock',report:cut}});
 expect(byId(r2.records).business!.assertions.find(a=>a.id==='cup-ownership-traceable')).toMatchObject({passed:false,detail:expect.stringContaining('cup-1')});
});

test('an FD01 mock report evaluates the food invariants only; an unknown matrix id is an issue, not a record',async()=>{
 const report=await executeFixture('FD01',{seed:42});
 const {records}=buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'FD01',source:{kind:'mock',report}});
 expect(byId(records).business).toMatchObject({result:'pass',requirementIds:expect.arrayContaining(['FD-01'])});
 expect(byId(records).business!.assertions.map(a=>a.id)).not.toContain('cup-ownership-traceable');
 expect(buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'NOPE',source:{kind:'mock',report}})).toEqual({records:[],issues:['MATRIX_ID_UNKNOWN:NOPE']});
});

test('a SIL run over a protocol double is business fidelity with physics not_run; a sil-evidence manifest becomes physics_sim and evaluates its assertions',async()=>{
 const out=await mkdtemp(join(tmpdir(),'lab-v2-ev-'));
 try{
  const result=await runSilScenario({scenarioId:'FD01',scenarioRevision:1,seed:17,project:restaurant(),sourceCommit:'test-commit',outDir:out,world:compiledWorld(out),backendSetId:'simulation-default',maxIterations:4000,paceMs:0,
   backendFactory:async(w,runId)=>startGazeboBackend(w,runId,{port:new FakeWorkerPort({nativeResult:'completed'})})});
  const {records}=buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'FD01',source:{kind:'sil',manifest:result.manifest,assertions:result.assertions}});
  for(const r of records)expect(validateEvidenceV2(r)).toMatchObject({ok:true});
  const rows=byId(records);
  expect(rows.business).toMatchObject({result:'pass',actualFidelity:'business',inputsManifest:{mode:'simulation',backends:['gazebo_nav2'],seed:17}});
  expect(rows.physics).toMatchObject({result:'not_run'});expect(rows.physics.assertions[0]!.detail).toContain('PHYSICS_EVIDENCE_MISSING');
  expect(rows.business.artifacts.map(a=>a.name).sort()).toEqual(['assertions.json','barriers.json','contacts.json','effects.json','faults.json','journal.json','telemetry.json']);
  const sil={...result.manifest,evidence:'sil'},assertions=result.assertions.map(a=>a.id==='SIM.no-contact'?{...a,result:'pass' as const,reason:undefined,detail:'0 contacts (physics_sim)'}:a);
  const real=byId(buildSimulationEvidence({schemaHash:SCHEMA,matrixId:'FD01',source:{kind:'sil',manifest:sil,assertions}}).records);
  expect(real.business).toMatchObject({actualFidelity:'physics_sim'});
  expect(real.physics).toMatchObject({result:'not_run'}); // min-separation is still not_run for a single robot: one not_run row keeps the record not_run
  expect(real.physics.assertions.find(a=>a.id==='SIM.no-contact')).toMatchObject({passed:true});
 }finally{await rm(out,{recursive:true,force:true});}
});
