import { describe, expect, it } from 'vitest';
import { defaultProject } from '../../src/project/default';
import { buildBundle, validateBundle } from '../../src/deployment/bundle';

describe('draft deployment bundle', () => {
  it('exports hashed inputs without promoting simulation into hardware validation', async () => {
    const project=defaultProject();
    const bundle=await buildBundle(project,[{id:'sim-1',mode:'business_sim',outcome:'completed'}]);
    expect(bundle.status).toBe('draft');
    expect(bundle.readiness.find(item=>item.id==='configuration')?.status).toBe('ready');
    expect(bundle.readiness.find(item=>item.id==='hardware')?.status).toBe('blocked_external');
    expect(bundle.hashes.design).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.hashes.candidate).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.payload.profileCandidate.validation).toBe('simulated');
    expect((await validateBundle(bundle)).ok).toBe(true);
    expect(Object.keys(bundle.files)).toContain('checksums.json');
  });
  it('attaches a source session report by snapshot ID and exports only a sanitized hash reference', async () => {
    const project=defaultProject();
    const report={
      schemaVersion:1,mode:'business_sim',sourceCommit:'a'.repeat(40),project,
      snapshot:{id:'source-run-1',mode:'business_sim',status:'awaiting_load',stage:'load',revision:2,robotPosition:{x:1,y:6.8},target:null,served:'0',loaded:false,events:[{type:'RobotCommandIssued',at:'2026-11-01T00:00:00.000Z',payload:{controlEpoch:1}}],elapsedMs:1000,sourceCommit:'a'.repeat(40),scenarioId:'S01',seed:1},
      events:[{id:'event-1',type:'RobotCommandIssued',payload:{controlEpoch:1}}],
      journal:[{commandId:'command-1',payload:{controlEpoch:1,missionId:'historical-mission'}}],
      effects:[{type:'robot.execute',payload:{controlEpoch:1}}],faults:[],
      coverage:{businessSimulation:true,nativeExecution:false,physicalStop:false,collisionAvoidance:false,sse:false},
      limitations:['Synthetic observations are software evidence only.']
    };
    const bundle=await buildBundle(project,[report]);
    expect(bundle.payload.evidenceRefs).toEqual([{id:'source-run-1',mode:'business_sim',sourceCommit:'a'.repeat(40),trust:'unverified',hash:expect.stringMatching(/^[a-f0-9]{64}$/)}]);
    const encoded=JSON.stringify(bundle);
    expect(encoded).not.toContain('controlEpoch');
    expect(encoded).not.toContain('historical-mission');
    expect(encoded).not.toContain('robot.execute');
    const changed=await buildBundle(project,[{...report,journal:[{commandId:'command-1',payload:{controlEpoch:2,missionId:'historical-mission'}}]}]);
    expect(changed.payload.evidenceRefs[0].hash).not.toBe(bundle.payload.evidenceRefs[0].hash);
    expect((await validateBundle(bundle)).ok).toBe(true);
    await expect(buildBundle(project,[{...report,snapshot:{...report.snapshot,validation:'hardware_validated'}}])).rejects.toThrow(/VALIDATION/);
  });
  it('keeps configuration pending when the candidate footprint cannot clear furniture', async () => {
    const project=defaultProject();
    project.world.points.find(point=>point.id==='table-1')!.y=1.54;
    const bundle=await buildBundle(project);
    expect(bundle.readiness.find(item=>item.id==='configuration')).toMatchObject({status:'pending',reasons:expect.arrayContaining(['FOOTPRINT_COLLISION'])});
    expect(bundle.readiness.find(item=>item.id==='hardware')?.status).toBe('blocked_external');
  });
  it('does not mark an unknown Valetudo footprint ready', async () => {
    const project=defaultProject();
    project.design.chassis='valetudo';
    const bundle=await buildBundle(project);
    expect(bundle.payload.profileCandidate.footprint).toBeNull();
    expect(bundle.readiness.find(item=>item.id==='configuration')).toMatchObject({status:'pending',reasons:expect.arrayContaining(['FOOTPRINT_UNAVAILABLE'])});
  });
  it('changes hashes with configuration revisions and detects tampering', async () => {
    const project=defaultProject();
    const before=await buildBundle(project);
    const after=await buildBundle({...project,design:{...project.design,trays:4,revision:2}});
    expect(before.hashes.design).not.toBe(after.hashes.design);
    expect(before.hashes.candidate).not.toBe(after.hashes.candidate);
    before.payload.design.trays=4;
    expect((await validateBundle(before)).ok).toBe(false);
  });
  it('rejects live state, credentials and forged validation in candidate inputs', async () => {
    const project=defaultProject();
    await expect(buildBundle({...project,missions:[]} as typeof project)).rejects.toThrow();
    await expect(buildBundle(project,[{id:'fake',mode:'hardware_test',validation:'hardware_validated'}])).rejects.toThrow(/VALIDATION/);
    await expect(buildBundle(project,[{id:'secret',password:'no'}])).rejects.toThrow(/FORBIDDEN/);
    const bundle=await buildBundle(project);
    (bundle.payload as unknown as Record<string,unknown>).missions=[];
    expect((await validateBundle(bundle)).ok).toBe(false);
    const credentials=await buildBundle(project);
    (credentials.payload.profileCandidate as unknown as Record<string,unknown>).credentials={password:'must-not-export'};
    expect((await validateBundle(credentials)).reasons).toContain('FORBIDDEN_DEPLOYMENT_FIELD');
    const activeEpoch=await buildBundle(project);
    (activeEpoch.payload.profileCandidate as unknown as Record<string,unknown>).controlEpoch=1;
    expect((await validateBundle(activeEpoch)).reasons).toContain('FORBIDDEN_DEPLOYMENT_FIELD');
  });
});
