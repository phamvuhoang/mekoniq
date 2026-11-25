import {expect,test,vi} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
import {validateProjectV2} from '../../src/project/schema';
import fixture from '../../fixtures/twins/coffee-cell-v2.json';
import {captureEvidence,evidenceStatus} from '../../src/reports/evidence';
vi.stubGlobal('localStorage',{getItem:()=> 'en',setItem:()=>{}});
const {armRows}=await import('../../src/twin/coffee-cell');
test('illustrative arm profile survives project validation with explicit units and normalized base transform',()=>{
 expect(validateProjectV2(fixture.project).armCollisionProfile).toEqual(fixture.project.armCollisionProfile);
 const invalid=structuredClone(fixture.project);invalid.armCollisionProfile.baseInMap.quaternionXyzw=[0,0,0,0.5];expect(()=>validateProjectV2(invalid)).toThrow(/INVALID_PROJECT/);
 invalid.armCollisionProfile.baseInMap.quaternionXyzw=[0,0,0,1];invalid.armCollisionProfile.units='mm';expect(()=>validateProjectV2(invalid)).toThrow(/INVALID_PROJECT/);
});
test('arm inspector names scene scope/revision and never shows future collision evidence at replay cursor',()=>{
 const {report}=coffeeReplay();report.coffee!.armTrace.collision={world:[],checks:4,last:{ok:true,engine:'capsule-sweep-v1',modelRevision:'model',geometryRevision:'b'.repeat(64)},
  scene:{available:true,scope:'self_scene_robot',revision:'a'.repeat(64),profileRevision:3,tick:40}};
 expect(armRows(report,40).find(r=>r.key==='arm-scene')).toMatchObject({source:'modeled',observed:expect.stringContaining('project fixtures + robots · illustrative · rev 3')});
 expect(armRows(report,39).find(r=>r.key==='arm-scene')).toMatchObject({source:'unknown',observed:'no evidence at this cursor'});
 expect(armRows(report,39).find(r=>r.key==='arm-checker')).toBeUndefined();
 report.coffee!.armTrace.collision.scene={available:false,scope:'self_injected_only',reason:'ARM_COLLISION_PROFILE_MISSING',revision:'a'.repeat(64),profileRevision:null,tick:40};
 expect(armRows(report,40).find(r=>r.key==='arm-scene')).toMatchObject({source:'unknown',observed:expect.stringContaining('self + injected obstacles')});
});
test('arm scene profile revision, frame and dimensions invalidate evidence without rewriting it',()=>{
 const {report}=coffeeReplay(),project=validateProjectV2(fixture.project),saved=captureEvidence(report,project),before=JSON.stringify(saved);
 for(const edit of [(p:typeof project)=>p.armCollisionProfile!.revision++,(p:typeof project)=>p.armCollisionProfile!.baseInMap.position[0]!+=0.1,
  (p:typeof project)=>p.armCollisionProfile!.fixtureHeightM+=0.1,(p:typeof project)=>p.armCollisionProfile!.robotHeightM+=0.1]){
  const changed=structuredClone(project);edit(changed);expect(evidenceStatus(saved,changed)).toMatchObject({stale:true,scopes:['profile']});
 }
 expect(JSON.stringify(saved)).toBe(before);expect(evidenceStatus(saved,project)).toMatchObject({stale:false});
});
