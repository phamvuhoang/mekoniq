import type { JsonObject } from '../../../contracts/src/index';
export interface MissionStop extends JsonObject { id:string;action:string;targetId:string;status:string;allocationIds:string[] }
export function cancellationAction(loaded:boolean):string {return loaded?'return_then_unload':'cancel_unloaded';}
