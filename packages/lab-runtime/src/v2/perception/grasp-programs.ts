// Source-owned pick programs: requests select an ID, never physical limits, offsets or grip strength.
import {hashJson} from '../hash';
import type {ArmProgramSet} from '../../../../cell-adapters/src/mock-arm';
import type {ArmProgramRecord} from '../report';
import type {GraspPlanInput} from './grasp-conditioning';
export interface GraspProgram {id:'cup-pick-two-stage-v1';revision:1;calibration:'not_calibrated';pickInsetM:number;captureM:number;approach:'unchanged';secureClose:'original_closed_target';digest:string}
const definition={id:'cup-pick-two-stage-v1' as const,revision:1 as const,calibration:'not_calibrated' as const,pickInsetM:0.02,captureM:0.07,approach:'unchanged' as const,secureClose:'original_closed_target' as const};
const twoStage:Readonly<GraspProgram>=Object.freeze({...definition,digest:hashJson(definition)});
export const GRASP_PROGRAM_IDS=Object.freeze([twoStage.id]);
export function registeredGraspProgram(id:string):Readonly<GraspProgram>{
 if(id!==twoStage.id)throw Error('GRASP_PROGRAM_NOT_REGISTERED');return twoStage;
}
export interface GraspProgramRef {id:string;revision:number;digest:string;executionDigest:string}
/** Bind the registration's offset rule to the actual resolved offsets and contact configuration this run used. */
export const graspProgramExecutionDigest=(registration:Readonly<GraspProgram>,graspOffsets:GraspPlanInput['graspOffsets'],contact:NonNullable<ArmProgramSet['contact']>)=>hashJson({registration,graspOffsets,contact});
export function matchesGraspProgramRecord(id:string|undefined,ref:GraspProgramRef|undefined,record:ArmProgramRecord|undefined):boolean{
 if(id===undefined)return ref===undefined&&record?.graspProgram===undefined&&record?.graspOffsets===undefined;
 try{
  const registered=registeredGraspProgram(id);
  return !!ref&&!!record?.graspProgram&&!!record.graspOffsets&&!!record.programs.contact&&ref.id===id&&ref.revision===registered.revision&&ref.digest===registered.digest&&
   hashJson(record.graspProgram)===hashJson(registered)&&record.programsDigest===hashJson(record.programs)&&record.programs.contact.captureM===registered.captureM&&
   ref.executionDigest===graspProgramExecutionDigest(registered,record.graspOffsets,record.programs.contact);
 }catch{return false;}
}
