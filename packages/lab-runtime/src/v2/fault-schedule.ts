import Ajv from 'ajv';
import schema from '../../../contracts/schemas/lab-fault-schedule.schema.json';
import type {FaultScheduleEntry} from '../../../contracts/generated/lab-v2';
export type {FaultScheduleEntry};
export type FaultPhase='brew'|'grasp'|'handoff'|'delivery';
const shape=new Ajv({strict:true}).compile<FaultScheduleEntry>(schema);
export const COFFEE_FAULT_IDS=['ice-jam','milk-empty','dose-low','measure-unknown','measure-missing','measure-outlier','milk-expired','milk-warm','milk-unknown','cup-removed','coffee-reboot','drop-ack','duplicate-completion','machine-not-ready'];
export const ARM_FAULT_IDS=['arm-reboot','arm-drop','arm-following-error','arm-stop','arm-estop','arm-reset','arm-collision'];
export const AMR_FAULT_IDS=['collide','reboot','duplicate-arrival','localization-lost','map-changed','dock-offset','reorder-observations','delay-observation','crash-after-commit'];
export const NATIVE_FAULT_KINDS:Readonly<Record<string,string>>={'cup-removed':'coffee_machine','missing-cup':'coffee_machine','grip-failure':'arm','arm-drop':'arm','arm-reboot':'arm','controller-restart':'arm','tunnel-loss':'arm','amr-disconnect':'amr','amr-delay':'amr','delay-observation':'amr','blocker':'amr'};
export function validateFaultTarget(faultId:string,targetId:string,entities:readonly {id:string;kind:string}[],mode:string,armPlantId?:string):void{
 // The contact plant cannot drop a cup by changing mock custody. Admit this fault only on plants that implement it.
 if(armPlantId==='mujoco_arm'&&faultId==='arm-drop')throw new Error('FAULT_BACKEND_UNSUPPORTED');
 if(mode==='simulation'){if(!Object.hasOwn(NATIVE_FAULT_KINDS,faultId))throw new Error('FAULT_BACKEND_UNSUPPORTED');if(!entities.some(e=>e.id===targetId&&e.kind===NATIVE_FAULT_KINDS[faultId]))throw new Error('FAULT_TARGET_INVALID');return;}
 const kind=COFFEE_FAULT_IDS.includes(faultId)?'coffee_machine':ARM_FAULT_IDS.includes(faultId)?'arm':AMR_FAULT_IDS.includes(faultId)?'amr':null;
 if(!kind)throw new Error('FAULT_UNKNOWN');
 if(!entities.some(e=>e.id===targetId&&e.kind===kind))throw new Error('FAULT_TARGET_INVALID');
 if(mode!=='mock')throw new Error('FAULT_BACKEND_UNSUPPORTED');
}
export function validateFaultSchedule(value:unknown,entities:readonly {id:string;kind:string}[],mode:string,armPlantId?:string):FaultScheduleEntry[]{
 if(!Array.isArray(value)||value.length>100)throw new Error('FAULT_SCHEDULE_INVALID');const ids=new Set<string>();
 for(const e of value){if(!shape(e)||ids.has(e.id))throw new Error('FAULT_SCHEDULE_INVALID');ids.add(e.id);validateFaultTarget(e.faultId,e.targetId,entities,mode,armPlantId);}
 return structuredClone(value);
}
/** Overdue entries fire in declared order; callers persist the returned ids before dispatch. */
export function dueFaults(entries:readonly FaultScheduleEntry[],firedIds:ReadonlySet<string>,elapsedSimMs:number,phase:FaultPhase):readonly FaultScheduleEntry[]{
 if(!Number.isFinite(elapsedSimMs)||elapsedSimMs<0)throw new Error('FAULT_CLOCK_INVALID');
 return entries.filter(e=>!firedIds.has(e.id)&&(e.trigger.kind==='elapsed_sim_ms'?elapsedSimMs>=e.trigger.value:e.trigger.value===phase));
}
export interface FaultFireRecord {id:string;tick:number;expiresAtMs:number;outcome:'dispatching'|'applied'|'unknown';windowEnded?:boolean}
