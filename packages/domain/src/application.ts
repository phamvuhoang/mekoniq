import type {CommandEnvelope,Scope} from '../../contracts/src/index';
import {ModuleRegistry} from './modules';
import {registerRestaurantModules,commandPermissions} from './restaurant';
import {registerContinuityModules,continuityHandlers} from './continuity/module';
import {registerPolicyModule} from './policy/module';
import {registerLayout} from './configuration/layout';
export const productionPermissions:Record<string,string>={...commandPermissions,
 'Policy.Check':'configuration.read','Configuration.Apply':'configuration.publish',
 'Venue.Configure':'configuration.publish',
 ...Object.fromEntries(Object.keys(continuityHandlers).map(type=>[type,
   ['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(type)?'continuity.capture':
   ['SettlementGrant.Use','SettlementGrant.Return'].includes(type)?'payment.cash':type.startsWith('Import.')?'continuity.import.approve':'continuity.resolve']))
};
export function createProductionRegistry() {
 const registry=new ModuleRegistry();registerRestaurantModules(registry);registerContinuityModules(registry);registerPolicyModule(registry);registerLayout(registry);return registry;
}
// This object comes from verified native grants/server identity, never the wire command.
export type Principal={id:string;deviceId:string;scope:Scope;permissions:string[];expiresAtMs:number;stationIds:string[]};
export function authorizeVenueCommand(principal:Principal,command:CommandEnvelope,nowMs:number):boolean {
 if(principal.id!==command.actorRef||principal.deviceId!==command.deviceId||principal.scope.organizationId!==command.organizationId||principal.scope.venueId!==command.venueId)return false;
 const capture=['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(command.type);
 if(nowMs>=principal.expiresAtMs&&!capture)return false;
 const permission=productionPermissions[command.type];
 if(!permission||(!principal.permissions.includes('*')&&!principal.permissions.includes(permission)))return false;
 if(command.type.startsWith('Kitchen.')&&!principal.permissions.includes('*')&&!principal.stationIds.includes(String(command.payload.stationId)))return false;
 return true;
}
