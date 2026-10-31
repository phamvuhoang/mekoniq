import type {TenantScope} from './tenant-context';
export type Actor={id:string;organizationId:string;venueIds:string[];permissions:string[];permissionsByVenue?:Record<string,string[]>;stationIdsByVenue?:Record<string,string[]>;role:string;deviceId?:string;deviceEpoch?:string};
const roles:Record<string,string[]>={
 owner:['*'],manager:['identity.delegate','fulfillment.write','continuity.capture','robot.stop','configuration.publish','configuration.read','catalog.publish','catalog.read','device.enroll','sync.write','sync.read','relay.write','assets.write','assets.read','order.read','order.write','kitchen.write','mission.write','billing.write','payment.cash','shift.write','continuity.import.approve','continuity.resolve','report.read'],
 cashier:['relay.write','continuity.capture','robot.stop','catalog.read','order.read','order.write','billing.write','payment.cash','shift.write','fulfillment.write','mission.write','sync.read'],
 chef:['relay.write','robot.stop','catalog.read','order.read','kitchen.write','sync.read'],
 executor:['robot.observe','robot.stop'],
 guest:['guest.order','guest.call','guest.bill','payment.claim'],
};
export function rolePermissions(role:string){return [...(roles[role]??[])];}
export function permissionsForVenue(actor:Actor,venueId:string){return actor.permissionsByVenue?(actor.permissionsByVenue[venueId]??[]):actor.permissions;}
export function authorize(actor:Actor|null,permission:string,scope:TenantScope) {
 if(!actor)return {ok:false as const,code:'UNAUTHENTICATED'};
 if(actor.organizationId!==scope.organizationId||!actor.venueIds.includes(scope.venueId))return {ok:false as const,code:'SCOPE_DENIED'};
 const permissions=permissionsForVenue(actor,scope.venueId);
 if(!permissions.includes('*')&&!permissions.includes(permission))return {ok:false as const,code:'PERMISSION_DENIED'};
 return {ok:true as const,events:[],value:{}};
}
export function requirePermission(actor:Actor|null,permission:string,scope:TenantScope) {
 const d=authorize(actor,permission,scope);if(!d.ok)throw new Error(d.code);
 return actor as Actor;
}
