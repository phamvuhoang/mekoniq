import type { CommandEnvelope, DomainEvent, EffectIntent, JsonObject, Snapshot } from '../../../contracts/src/index';
import { created, fail, stableId } from '../restaurant-context';
import type { MissionStop } from './stop';
export function issueRobotCommand(c:CommandEnvelope,robot:Snapshot,missionId:string,revision:number,stop:MissionStop):{event:DomainEvent;effect:EffectIntent;commandId:string} {
 const target=((robot.state.bindings ?? {}) as JsonObject)[stop.targetId];
 if(!target || typeof target!=='object'||Array.isArray(target)) return fail('TARGET_UNBOUND');
 const commandId=stableId('robot-command',c,`${missionId}:${revision}:${stop.id}`);
 const command={schemaVersion:1,commandId,operationId:c.operationId,organizationId:c.organizationId,venueId:c.venueId,robotId:robot.ref.id,missionId,stopId:stop.id,missionRevision:revision,controlEpoch:Number(robot.state.controlEpoch),issuerDeviceId:String(robot.state.ownerDeviceId ?? fail('ROBOT_OWNER_REQUIRED')),issuedAt:c.recordedAt,expiresAt:new Date(Date.parse(c.recordedAt)+60000).toISOString(),target:structuredClone(target),limits:{trays:robot.state.trays ?? 1,maxLoadMinor:robot.state.maxLoadMinor ?? '0'}};
 return {commandId,event:created('RobotCommandIssued','robot-command',commandId,{...command,status:'pending'}),effect:{id:commandId,type:'robot.execute',payload:command}};
}
