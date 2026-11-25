import Ajv from 'ajv';
import schema from './contracts/lab-fault-schedule.schema.json' with {type:'json'};
import type {LabProjectV2} from '../shared/types';
export interface FaultScheduleEntry {id:string;faultId:string;targetId:string;trigger:{kind:'elapsed_sim_ms';value:number}|{kind:'phase';value:'brew'|'grasp'|'handoff'|'delivery'};durationMs:number}
const shape=new Ajv({strict:true}).compile<FaultScheduleEntry>(schema);
/** UI subset; the source validates every submitted target/backend again. */
export const scheduledFaults=[{id:'cup-removed',kind:'coffee_machine'},{id:'machine-not-ready',kind:'coffee_machine'},{id:'coffee-reboot',kind:'coffee_machine'},{id:'arm-drop',kind:'arm'},{id:'arm-reboot',kind:'arm'},{id:'arm-following-error',kind:'arm'},{id:'reboot',kind:'amr'},{id:'localization-lost',kind:'amr'},{id:'dock-offset',kind:'amr'}] as const;
export const nativeScheduledFaults=[{id:'cup-removed',kind:'coffee_machine'},{id:'grip-failure',kind:'arm'},{id:'controller-restart',kind:'arm'},{id:'tunnel-loss',kind:'arm'},{id:'amr-disconnect',kind:'amr'},{id:'amr-delay',kind:'amr'},{id:'blocker',kind:'amr'}] as const;
export function validateSchedule(value:unknown):FaultScheduleEntry[]{
 if(!Array.isArray(value)||value.length>100)throw new Error('FAULT_SCHEDULE_INVALID');const ids=new Set<string>();
 for(const e of value){if(!shape(e)||ids.has(e.id))throw new Error('FAULT_SCHEDULE_INVALID');ids.add(e.id);}
 return structuredClone(value);
}
export function editSchedule(project:LabProjectV2,entries:unknown,mode:'mock'|'simulation'='mock'):LabProjectV2{
 const checked=validateSchedule(entries);for(const e of checked){const f=(mode==='simulation'?nativeScheduledFaults:scheduledFaults).find(f=>f.id===e.faultId);if(!f||!project.entities.some(t=>t.id===e.targetId&&t.kind===f.kind))throw new Error('FAULT_TARGET_UNSUPPORTED');}
 return {...structuredClone(project),revision:project.revision+1,updatedAt:new Date().toISOString(),faultSchedule:checked};
}
