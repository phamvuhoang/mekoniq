/** Native birth observations are opt-in for the derived pick rig. Ordinary world
 * payloads and snapshots have no new field or observation requirement. */
import type {Sim3DSnapshotV1,LabWorldSceneV1} from '../navigation2d/contracts';
import type {WorldEvidenceRecord} from '../../../../contracts/generated/navigation2d';
import {hashJson} from '../hash';
import {driveWireCommand} from '../control/drive-run';
export function validateWorldBirth(snapshot:Sim3DSnapshotV1,command:WorldEvidenceRecord['command'],scene:LabWorldSceneV1,previous:Sim3DSnapshotV1|undefined){
 const native=snapshot.worldStep?.birthObservations??[],births=command?.worldInteractions?.filter(i=>i.kind==='birth')??[],fail=()=>{throw Error('WORLD_BIRTH_OBSERVATION_INVALID');};
 if(scene.id!=='pick-rig-v1'){if(native.length)fail();return;}
 if(native.length!==births.length)fail();
 for(const [n,i]of births.entries()){
  const r=native[n]!;
  if(!previous||r.method!=='mujoco-freejoint-body-before-step-v1'||r.frame!=='map'||r.propId!==i.propId||r.cupId!==i.cupId||r.eventId!==i.eventId||r.targetTick!==snapshot.tick||r.runId!==snapshot.runId||r.bootId!==snapshot.bootId||r.sceneDigest!==snapshot.sceneDigest||r.requestId!==`world-${snapshot.tick+2}`||r.requestDigest!==hashJson((scene.engine?.driveModelRef&&command?driveWireCommand(command as never):command) as never)||r.physicsSubstepsBefore!==previous?.worldStep?.physicsSubsteps||r.physicsSubstepsBefore!==snapshot.worldStep!.physicsSubsteps-10||[...r.qposPositionM,...r.bodyPositionM,...r.quaternionXyzw].some(v=>!Number.isFinite(v))||Math.hypot(...r.qposPositionM.map((v,k)=>v-r.bodyPositionM[k]!))>1e-10||Math.abs(Math.hypot(...r.quaternionXyzw)-1)>1e-10)fail();
 }
}
