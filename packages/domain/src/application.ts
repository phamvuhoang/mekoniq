import type {CommandEnvelope,JsonObject,Scope} from '../../contracts/src/index';
import {ModuleRegistry} from './modules';
import {registerRestaurantModules,commandPermissions} from './restaurant';
import {registerContinuityModules,continuityHandlers} from './continuity/module';
import {registerPolicyModule} from './policy/module';
import {registerLayout} from './configuration/layout';
import {registerTrialImport} from './configuration/trial-import';
export const productionPermissions:Record<string,string>={...commandPermissions,
 'Policy.Check':'configuration.read','Configuration.Apply':'configuration.publish',
 'Venue.Configure':'configuration.publish','Trial.ImportPreview':'configuration.publish','Trial.ImportApply':'configuration.publish',
 ...Object.fromEntries(Object.keys(continuityHandlers).map(type=>[type,
   ['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(type)?'continuity.capture':
   ['SettlementGrant.Use','SettlementGrant.Return'].includes(type)?'payment.cash':type.startsWith('Import.')?'continuity.import.approve':'continuity.resolve']))
};
/** Commands whose payload may carry coupons; carrying any needs discount.apply on top of the per-type permission. */
const couponCommands=new Set(['Catalog.Quote','Order.Place','Order.Amend','Combo.Quote','WeighedItem.Quote']);
/** A keyed (not scale-read) weight sets the price of a line, so it is an approval: it needs weighed.manual on top of the command's own permission. */
const manualWeight=(payload:JsonObject)=>[...(Array.isArray(payload.items)?payload.items as JsonObject[]:[]),...(payload.measure?[{measure:payload.measure} as JsonObject]:[])].some(i=>(i?.measure as JsonObject|undefined)?.source==='manual');
/** Cash commands that act for someone else's shift, approve a variance or adjust a closed shift need a manager's shift.approve on top of shift.write. */
const approvalCommands=new Set(['Shift.Close','Cash.RecordMovement']);
export function requiredPermissions(type:string,payload:JsonObject):string[] {
 const base=productionPermissions[type];
 if(!base)return [];
 // Releasing a zone on written evidence (an `unknown` reservation: no proof the robot left) is a manager decision, not the executor's.
 if(type==='Zone.Release'&&payload.evidence!==undefined)return [base,'robot.configure'];
 if(approvalCommands.has(type)&&(payload.approve===true||payload.adjustment===true))return [base,'shift.approve'];
 // Punching for somebody else (explicit userId) is a manager's call on top of the plain clock permission.
 if((type==='Staff.ClockIn'||type==='Staff.ClockOut')&&payload.userId!==undefined)return [base,'workforce.approve'];
 // Forfeiting a no-show deposit is a money decision on top of recording the no-show.
 if(type==='Booking.NoShow'&&payload.forfeitDeposit===true)return [base,'deposit.manage'];
 if(!couponCommands.has(type))return [base];
 const ids=payload.discountIds;
 return [base,...(ids!==undefined&&!(Array.isArray(ids)&&ids.length===0)?['discount.apply']:[]),...(manualWeight(payload)?['weighed.manual']:[])];
}
export function createProductionRegistry() {
 const registry=new ModuleRegistry();registerRestaurantModules(registry);registerContinuityModules(registry);registerPolicyModule(registry);registerLayout(registry);registerTrialImport(registry);return registry;
}
// This object comes from verified native grants/server identity, never the wire command.
export type Principal={id:string;deviceId:string;scope:Scope;permissions:string[];expiresAtMs:number;stationIds:string[]};
export function authorizeVenueCommand(principal:Principal,command:CommandEnvelope,nowMs:number):boolean {
 if(principal.id!==command.actorRef||principal.deviceId!==command.deviceId||principal.scope.organizationId!==command.organizationId||principal.scope.venueId!==command.venueId)return false;
 const capture=['Continuity.CaptureTicket','Continuity.RecordPaymentObservation'].includes(command.type);
 if(nowMs>=principal.expiresAtMs&&!capture)return false;
 const needed=requiredPermissions(command.type,command.payload);
 if(!needed.length||!needed.every(permission=>principal.permissions.includes('*')||principal.permissions.includes(permission)))return false;
 if(command.type.startsWith('Kitchen.')&&!principal.permissions.includes('*')&&!principal.stationIds.includes(String(command.payload.stationId)))return false;
 return true;
}
