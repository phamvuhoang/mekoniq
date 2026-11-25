/** What a tray run really used and really moved, compared with what the registry says: pure, so a recording with a changed document or a different person is refused before any metric is read. */
import {hashJson} from '../hash';
import {actorPoseAt,type ResolvedActor} from '../navigation2d/scenario-fixtures';
import {DRIVE_DOC_PINS,LOAD_SHAPES,PHYSICS,controlShape} from './physics-inputs';
import {MOBILE_CONTROLLER_POLICY,MOBILE_STOP_POLICY} from './mujoco-mobile';
import {TRAY_EXPERIMENTS,type TrayExperimentId} from './tray-experiments';
export interface TrayDocuments{load:{id:string;digest?:string;modelRef?:unknown}&Record<string,unknown>;physicsSha:string;driveControl:{plantModelDigest:string;controllers:{controllerId:string;params:Record<string,unknown>}[]};plant:string;controllerPolicy:unknown;stopPolicy:unknown}
/** The names of the documents that are not the registered ones: the load (shape, without its seal and model reference), the contact profile (by file hash), the control profile (shape, bound to this plant), the controller and stop policies. */
export function trayDocumentIssues(id:TrayExperimentId,d:TrayDocuments):string[]{
 const e=TRAY_EXPERIMENTS[id],out:string[]=[],{digest:_d,modelRef:_m,...loadShape}=d.load;void _d;void _m;
 if(hashJson(loadShape)!==LOAD_SHAPES[e.load])out.push('load');
 if(d.physicsSha!==PHYSICS[e.physics])out.push('physics');
 if(hashJson(controlShape(d.driveControl as never))!==DRIVE_DOC_PINS[e.driveExperimentId]?.control)out.push('driveControl');
 if(d.driveControl.plantModelDigest!==d.plant)out.push('plantModelDigest');
 if(hashJson(d.controllerPolicy)!==hashJson(MOBILE_CONTROLLER_POLICY))out.push('controllerPolicy');
 if(hashJson(d.stopPolicy)!==hashJson(MOBILE_STOP_POLICY))out.push('stopPolicy');
 return out;
}
/**
 * The scripted person of the run, from the evidence: the file the worker was bound to is the registered body, and every step carried exactly the scheduled pose of every actor (none when the variant has none).
 * `actors` are the registered actors resolved for this scene and seed; `control` is the recorded control stream, one record per step.
 */
export function actorEvidenceIssues(control:readonly {targetTick:number;actorUpdates:unknown[]}[],o:{actors:readonly Pick<ResolvedActor,'id'|'startTick'|'speedMps'|'path'>[];fixtureBytes:string|null;recordedFixtureBytes:string|null;expectedSteps?:number;fixtureFile?:unknown}):string[]{
 const out:string[]=[];
 if(o.recordedFixtureBytes!==o.fixtureBytes)out.push('fixtureFile');
 if(o.expectedSteps!==undefined&&control.length!==o.expectedSteps)out.push('controlSteps');
 for(const c of control){
  const want=o.actors.map(a=>({actorId:a.id,poseMap:actorPoseAt(a,c.targetTick)}));
  if(hashJson(c.actorUpdates)!==hashJson(want)){out.push(`actorUpdates:${c.targetTick}`);if(out.length>=5)break;}
 }
 return out;
}
