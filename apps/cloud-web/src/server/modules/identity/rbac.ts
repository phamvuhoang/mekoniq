import type {TenantScope} from './tenant-context';
export type Actor={id:string;organizationId:string;venueIds:string[];permissions:string[];permissionsByVenue?:Record<string,string[]>;stationIdsByVenue?:Record<string,string[]>;role:string;deviceId?:string;deviceEpoch?:string};
const roles:Record<string,string[]>={
 owner:['*'],manager:['identity.delegate','discount.apply','fulfillment.write','continuity.capture','robot.stop','configuration.publish','configuration.read','catalog.publish','catalog.read','device.enroll','sync.write','sync.read','relay.write','assets.write','assets.read','order.read','order.write','kitchen.write','mission.write','robot.configure','robot.traffic','billing.write','payment.cash','payment.terminal','payment.verify','payment.refund','bill.void','shift.write','shift.approve','print','print.resolve','continuity.import.approve','continuity.resolve','report.read','inventory.write','inventory.consume','procurement.write','procurement.approve','procurement.receive','inventory.count','inventory.approve','workforce.write','workforce.approve','workforce.clock'],
 cashier:['relay.write','continuity.capture','robot.stop','catalog.read','order.read','order.write','billing.write','payment.cash','payment.terminal','shift.write','print','fulfillment.write','mission.write','workforce.clock','sync.read'],
 chef:['relay.write','robot.stop','catalog.read','order.read','kitchen.write','inventory.consume','inventory.count','workforce.clock','sync.read'],
 executor:['robot.observe','robot.stop','robot.traffic'],
 spooler:['print.observe'],
 guest:['guest.order','guest.call','guest.bill','payment.claim'],
 // Guest-facing venue devices: a kiosk orders with a staff-issued kiosk token, a robot screen for the table its paired robot waits at.
 kiosk:['guest.order','guest.call','guest.bill','catalog.read'],
 'robot-display':['guest.order','guest.call','guest.bill','catalog.read'],
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
