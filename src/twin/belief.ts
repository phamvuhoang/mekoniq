// R4.4 belief layer, pure: what the controller believed about each cup at a replay/run cursor, from `report.perceptionEvidence` (the runtime's own record of the stream).
// Truth is drawn only as scoring (the connector to where the cup was when the estimate was observed); nothing here is recomputed in the browser.
import type {BeliefObject,BeliefRecord} from '../shared/navigation2d';
import {composePose,type Pose} from './frames';
export type BeliefAt={available:false;reason:string}|{available:true;belief:BeliefObject;truthM:[number,number,number];errorM:number|null};
/** The newest record not later than the cursor. A dropped update keeps the belief the controller still holds (the last published one); a record with no belief for another reason
 * (the cup is out of view) ends it, and an invalid belief is never drawn. */
export function beliefAt(records:readonly BeliefRecord[],tick:number):BeliefAt{
 for(let i=records.length-1;i>=0;i--){
  const r=records[i]!;if(r.tick>tick)continue;
  if(r.belief)return r.belief.valid?{available:true,belief:r.belief,truthM:r.truthAtObservedTick as [number,number,number],errorM:r.errorM}:{available:false,reason:'NO_BELIEF_DATA'};
  if(!r.dropped)return {available:false,reason:r.reason??'NO_BELIEF_DATA'};
 }
 return {available:false,reason:'NO_BELIEF_DATA'};
}
export interface Ghost {objectId:string;beliefMapM:[number,number,number];truthMapM:[number,number,number];errorMm:number|null}
export type Ghosts={status:'none'}|{status:'no_data_at_cursor'}|{status:'data';items:Ghost[]};
const id=[0,0,0,1];
/** The ghosts at the frame's cursor. `none`: this report has no perception stream (a fixed-program or an older run); `no_data_at_cursor`: it has one but nothing is believed at this tick. */
export function ghostsAt(f:{view:{tick:number}|null;report:unknown},base:{position:readonly number[];quaternionXyzw:readonly number[]}|undefined):Ghosts{
 const p=(f.report as {perceptionEvidence?:{beliefs?:BeliefRecord[]}}|null)?.perceptionEvidence?.beliefs;
 if(!p?.length||!base||!f.view)return {status:'none'};
 const toMap=(v:number[])=>composePose(base as Pose,{position:v,quaternionXyzw:id}).position as [number,number,number],items:Ghost[]=[];
 for(const objectId of [...new Set(p.map(r=>r.objectId))].sort()){
  const b=beliefAt(p.filter(r=>r.objectId===objectId),f.view.tick);
  if(b.available)items.push({objectId,beliefMapM:toMap(b.belief.positionM),truthMapM:toMap(b.truthM),errorMm:b.errorM===null?null:b.errorM*1000});
 }
 return items.length?{status:'data',items}:{status:'no_data_at_cursor'};
}
