import {expect,test} from 'vitest';
import fixture from '../fixtures/simulation-study/mismatched-world.json';
import {buildSemanticStudy} from '../../packages/lab-runtime/src/v2/simulation3d/semantic-study';
test('explicit two-report mismatched common projection is incomparable and never ranked',()=>{
 const study=buildSemanticStudy(fixture as never);
 expect(study.status).toBe('incomparable');expect(study.reasonCodes).toContain('INPUTS_NOT_EQUIVALENT');expect(Object.hasOwn(study,'winner')).toBe(false);
});
import {afterAll,beforeAll} from 'vitest';
import {compileStudy,unitRun,artifact} from '../support/simulation-study';
import {semanticEquivalence} from '../../packages/lab-runtime/src/v2/simulation3d/semantic-study';
const runs:Awaited<ReturnType<typeof unitRun>>[]=[];const compiled:Awaited<ReturnType<typeof compileStudy>>[]=[];
beforeAll(async()=>{
 for(const engine of ['irsim_2d','webots_3d','mujoco_3d']){const c=await compileStudy('payload-empty-v1',engine);compiled.push(c);const run=await unitRun(c,engine);
  runs.push(run);
 }
});
afterAll(async()=>{for(const c of compiled)await c.close();});
const input=()=>{const equivalence=semanticEquivalence(runs[0]!);return {equivalence,runs:structuredClone(runs).map(r=>({...r,commonProjection:equivalence.commonProjection})),invariantPolicy:{id:'fd01-source-causal-v1',revision:1}};};
test('fresh equivalent geometric inputs compare source causality with IR-SIM dynamics unsupported, without ranking',()=>{
 const study=buildSemanticStudy(input());expect(study.reasonCodes).toEqual([]);expect(study.status).toBe('complete');expect(study.runs).toHaveLength(3);expect(study.unsupportedDimensions).toContainEqual(expect.objectContaining({engine:'irsim_2d',dimension:'contact',status:'unsupported'}));expect(study).not.toHaveProperty('winner');expect(study).not.toHaveProperty('rank');
});
test.each(['world','frame','goal','digest'])('rejects a %s binding or input mismatch without treating it as engine behavior',kind=>{
 const i=input();if(kind==='digest')i.runs[1]!.report.ref.sha256='0'.repeat(64);else{const j=i.runs[1]!.artifacts.findIndex(a=>a.ref.path==='navigation-scene.json'),s=JSON.parse(i.runs[1]!.artifacts[j]!.content);if(kind==='world')s.world.id='another-world';if(kind==='frame')s.robots[0].model.baseFrameId='another-frame';if(kind==='goal')s.robots[0].targetBindings[0].x+=.5;i.runs[1]!.artifacts[j]=artifact('navigation-scene.json',s);}
 const study=buildSemanticStudy(i);expect(study.status).toBe('incomparable');expect(study.reasonCodes).toContain('INPUTS_NOT_EQUIVALENT');
});
test('source served before its own handoff fails causality; unrelated global event ordering is not compared',()=>{
 const i=input(),r=JSON.parse(i.runs[1]!.report.content);r.businessEvents[2].at=new Date(0).toISOString();i.runs[1]!.report=artifact('report.json',r);
 const study=buildSemanticStudy(i);expect(study.status).toBe('failed');expect(study.invariants.some((x)=>x.id==='arrival-confirmation-served'&&x.status==='fail')).toBe(true);
});
test('unknown followed by another dispatch attempt fails independently of trajectory equality',()=>{
 const i=input(),r=JSON.parse(i.runs[0]!.report.content);r.businessEvents.push({sequence:'3',at:new Date(2000).toISOString(),type:'RobotCommandObserved',kind:'robot-command',id:'unknown-command',state:{status:'unknown'}});r.effects=[{id:'effect-unknown',type:'robot.execute',status:'unknown',attempts:2,payload:{commandId:'unknown-command'}}];i.runs[0]!.report=artifact('report.json',r);
 expect(buildSemanticStudy(i).invariants.some((x)=>x.id==='unknown-no-redispatch'&&x.status==='fail')).toBe(true);
});
test('registered study controller selects the actual sent-command ramp and preserves the legacy plant',async()=>{
 const {withSemanticStudyController}=await import('../../packages/lab-runtime/src/v2/simulation3d/semantic-study-policy');const {irsimPlant}=await import('../../packages/lab-runtime/src/v2/navigation2d/plant');
 const original=irsimPlant(),study=withSemanticStudyController(original);expect(original.identity.controller).toBeUndefined();expect(study.identity.controller).toEqual({identity:{id:'grid-diff-v1',version:'2+mujoco-sent-ramp-v1'},options:{ramp:'previous-sent-command-v1'}});expect(study.spawn).toBe(original.spawn);
});
test('trajectory bytes determine corridor metrics even if a report summary is changed',()=>{
 const i=input(),r=JSON.parse(i.runs[0]!.report.content);r.metrics.navigation={driveDistanceM:{'amr-1':999},minClearanceM:999};i.runs[0]!.report=artifact('report.json',r);
 const study=buildSemanticStudy(i);expect(study.differences.find(d=>d.runId===r.manifest.runId&&d.dimension==='driveDistanceM')?.value).toBe(0);
});
test('study schema rejects ranking and the offline CLI preserves existing reports',async()=>{
 const {default:Ajv}=await import('ajv'),schema=(await import('../../packages/contracts/schemas/semantic-study-v1.schema.json')).default,validate=new Ajv({strict:true}).compile(schema),study=buildSemanticStudy(input());expect(validate(study),JSON.stringify(validate.errors)).toBe(true);expect(validate({...study,winner:'mujoco_3d'})).toBe(false);
 const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawnSync}=await import('node:child_process'),dir=await mkdtemp(join(tmpdir(),'study-cli-'));
 try{const source=join(dir,'input.json'),out=join(dir,'output.json');await writeFile(source,JSON.stringify(input()));const args=['scripts/compare-simulations.mjs','--study',source,'--out',out],run=()=>spawnSync(process.execPath,args,{encoding:'utf8',timeout:30000});expect(run()).toMatchObject({status:0});const retained=await readFile(out,'utf8');expect(JSON.parse(retained)).toMatchObject({status:'complete',accepted:false,percentiles:null});expect(run()).toMatchObject({status:2});expect(await readFile(out,'utf8')).toBe(retained);}finally{await rm(dir,{recursive:true,force:true});}
});
test('a new command id for the same unknown mission is still a redispatch',()=>{
 const i=input(),r=JSON.parse(i.runs[0]!.report.content);r.businessEvents.push({sequence:'3',at:new Date(2000).toISOString(),type:'RobotCommandObserved',kind:'robot-command',id:'lost',state:{status:'unknown',missionId:'mission-1'}},{sequence:'4',at:new Date(2020).toISOString(),type:'RobotCommandIssued',kind:'robot-command',id:'new-id',state:{missionId:'mission-1'}});i.runs[0]!.report=artifact('report.json',r);expect(buildSemanticStudy(i).invariants.find(x=>x.runId===r.manifest.runId&&x.id==='unknown-no-redispatch')?.status).toBe('fail');
});
test('arrival is judged against the registered five-tick position, yaw and stopped window',()=>{
 const i=input(),r=JSON.parse(i.runs[0]!.report.content);r.businessEvents[0].state.stops[0].targetId='t-01';i.runs[0]!.report=artifact('report.json',r);
 expect(buildSemanticStudy(i).invariants.find(x=>x.runId===r.manifest.runId&&x.id==='arrival-policy-window')?.status).toBe('fail');
});
test('legacy compareRuns keeps cross-backend deltas null',async()=>{
 const {compareRuns}=await import('../../packages/lab-runtime/src/v2/comparison');const a=JSON.parse(runs[0]!.report.content),b=JSON.parse(runs[1]!.report.content),comparison=compareRuns(a,b);expect(comparison.comparable).toBe(false);expect(comparison.reasons).toContain('BACKENDS_DIFFER');expect(comparison.kpis.every(k=>k.delta===null)).toBe(true);
});
test('nominal cancel and unknown clauses are explicitly unexercised',()=>{
 const study=buildSemanticStudy(input());expect(study.invariants.filter(x=>['cancel-causality','unknown-no-redispatch'].includes(x.id)).every(x=>x.status==='not_run')).toBe(true);
});
test('a load arrival cannot stand in for a handoff and scripted confirmations retain their admitted delay',()=>{
 for(const mutate of [(r:Record<string,unknown>)=>{const events=r.businessEvents as {state:{stops:{action:string}[]}}[];events[0]!.state.stops[0]!.action='load';},(r:Record<string,unknown>)=>{const confirmations=r.confirmations as {provenance:string}[];confirmations[0]!.provenance='manual';}]){const i=input(),r=JSON.parse(i.runs[0]!.report.content);mutate(r);i.runs[0]!.report=artifact('report.json',r);expect(buildSemanticStudy(i).invariants.find(x=>x.runId===r.manifest.runId&&x.id==='arrival-confirmation-served')?.status).toBe('fail');}
});
import {resealStudyProfile} from '../support/simulation-study-mutations';
import {verifiedSimulationInput} from '../../packages/lab-runtime/src/v2/simulation3d/simulation-input';
import {documentDigest} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import cupProfile from '../../robotics/simulation-mujoco/fixtures/serve-payload-v1/cup-center.json';
const profileMutations:[string,string,(d:Record<string,unknown>)=>void,boolean?][]=[
 ['friction','drive-contact-profile.json',d=>{(d.contact as {sliding:number}).sliding=.99;}],
 ['solver','drive-contact-profile.json',d=>{(d.solver as {iterations:number}).iterations++;}],
 ['actuator','drive-contact-profile.json',d=>{d.velocityGainNmsPerRad=2.01;}],
 ['unsealed-physics','drive-contact-profile.json',d=>{(d.contact as {sliding:number}).sliding=.99;},false],
 ['nonempty','empty.json',d=>{d.props=structuredClone(cupProfile.props);}],
 ['malformed-empty','empty.json',d=>{d.unregisteredLoadSetting=true;}],
 ['model-hash','empty.json',d=>{(d.modelRef as {sha256:string}).sha256='f'.repeat(64);}],
 ['model-path','empty.json',d=>{d.modelRef={path:'canonical-physical-model.json',sha256:'830ba57f4f51272b533fd2c6a2c8743ba4857341af0e7af90f4525145b7249b9'};}],
];
test.each(profileMutations)('rejects coherent resealed %s input at semantic admission',(kind,path,mutate,seal=true)=>{
 const i=input(),original=JSON.stringify(runs[2]),run=resealStudyProfile(i.runs[2]!,path,mutate,seal);
 // The scene seal, every declared file ref and report/physics identity mirror are already coherent.
 expect(()=>verifiedSimulationInput(run)).not.toThrow();const changed=JSON.parse(run.artifacts.find(a=>a.ref.path===path)!.content);
 if(seal)expect(changed.digest).toBe(documentDigest(changed,'digest'));
 i.runs[2]={...run,commonProjection:i.equivalence.commonProjection};const study=buildSemanticStudy(i);
 expect(study.status,kind).toBe('incomparable');expect(study.reasonCodes).toContain('INPUTS_NOT_EQUIVALENT');expect(study.reasonCodes.some(r=>/^SEMANTIC_(PHYSICS|EMPTY_LOAD|LOAD_MODEL)_/.test(r))).toBe(true);
 expect(JSON.stringify(runs[2])).toBe(original);
});
