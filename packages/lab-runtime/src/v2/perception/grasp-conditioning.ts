// R4-B §6, R4-D25: a grasp from a belief passes four gates in a fixed order, belief -> region -> IK -> sweep. The first failing gate names the refusal and the later gates are `not_evaluated`;
// a refusal happens before any motion. Pure: the IK and the sweep come in as functions and the input carries a BeliefView, so the truth cannot reach this code (and `beliefErrorAtCommitM` stays
// null here: the plant, which holds the truth, fills it in for the record).
import type {BeliefObject,GraspAttempt} from '../../../../contracts/generated/navigation2d';
import type {BeliefView} from './belief';
export type GraspRefusal='BELIEF_UNAVAILABLE'|'BELIEF_STALE'|'BELIEF_OUT_OF_REGION'|'GRASP_UNREACHABLE'|'ARM_COLLISION'|'ARM_SWEEP_UNCERTAIN';
export const GRASP_WAYPOINTS=['pickApproach','pick','lift'] as const;
type Name=typeof GRASP_WAYPOINTS[number];
type Pose={positionM:[number,number,number];quaternionXyzw:[number,number,number,number]};
/** `path:'commit'` (R4-B §5.3): the arm already holds at its approach, so the path that will run is held pose -> pick -> lift; the new approach is neither solved, swept nor recorded. */
export interface GraspPlanInput {path?:'full'|'commit';view:BeliefView;cupId:string;tick:number;attemptIndex:number;mode:GraspAttempt['mode'];region:{centerM:[number,number];halfExtentM:[number,number]};
 graspOffsets:Record<Name,Pose>;seeds:Record<Name,number[]>;
 solve:(pose:{positionM:number[];quaternionXyzw:number[]},seed:number[])=>{ok:true;q:number[];residual:{positionM:number;orientationRad:number;condition:number}}|{ok:false;reason:string};
 sweep:(waypoints:number[][])=>{ok:true}|{ok:false;code:'ARM_COLLISION'|'ARM_SWEEP_UNCERTAIN'}}
/** The region is a closed box; a belief on its edge is inside up to float rounding (1 nm). */
const REGION_EPS_M=1e-9;
const NOT='not_evaluated';
export function planBeliefGrasp(i:GraspPlanInput):{ok:true;waypoints:Record<Name,number[]>;attempt:GraspAttempt}|{ok:false;code:GraspRefusal;attempt:GraspAttempt}{
 const attempt:GraspAttempt={attemptId:`${i.cupId}#${i.attemptIndex}`,cupId:i.cupId,index:i.attemptIndex,decidedTick:i.tick,mode:i.mode,beliefUsed:null,beliefErrorAtCommitM:null,
  gates:{belief:NOT,region:NOT,ik:NOT,sweep:NOT},ikResidual:[],outcome:'refused'};
 const refuse=(code:GraspRefusal,gate:keyof GraspAttempt['gates'])=>{attempt.gates[gate]=code;attempt.refusal=code;return {ok:false as const,code,attempt};};
 const got=i.view.get(i.cupId,i.tick);
 if(got.status!=='ok')return refuse(got.reason,'belief');
 attempt.gates.belief='pass';attempt.beliefUsed=got.belief satisfies BeliefObject;
 const [x,y]=got.belief.positionM,{centerM:[cx,cy],halfExtentM:[hx,hy]}=i.region;
 if(Math.abs(x-cx)>hx+REGION_EPS_M||Math.abs(y-cy)>hy+REGION_EPS_M)return refuse('BELIEF_OUT_OF_REGION','region');
 attempt.gates.region='pass';
 const waypoints={} as Record<Name,number[]>;
 const names=i.path==='commit'?GRASP_WAYPOINTS.filter(n=>n!=='pickApproach'):GRASP_WAYPOINTS;
 for(const name of names){
  const o=i.graspOffsets[name],r=i.solve({positionM:[x+o.positionM[0],y+o.positionM[1],got.belief.positionM[2]+o.positionM[2]],quaternionXyzw:o.quaternionXyzw},i.seeds[name]);
  if(!r.ok)return refuse('GRASP_UNREACHABLE','ik');
  waypoints[name]=r.q;attempt.ikResidual.push({...r.residual});
 }
 attempt.gates.ik='pass';attempt.waypointsRad=structuredClone(waypoints);
 const s=i.sweep(names.map(n=>waypoints[n]));
 if(!s.ok)return refuse(s.code,'sweep');
 attempt.gates.sweep='pass';
 return {ok:true,waypoints,attempt};
}
