import type { JsonObject } from '../../../contracts/src/index';
/**
 * What each robot driver can do at most. A robot's own manifest (state) must still claim a capability; the driver entry only caps it, so a
 * chassis name or an MQTT topic never implies support. `units` is the native length unit the adapter converts to/from (domain: metres/radians).
 * `zones`: the driver can honour shared zone reservations when the robot's manifest claims zoneEnforcement (a simulator claim covers simulators only).
 */
export type DriverProfile={targetKind:'ros'|'valetudo'|'vendor';units:'m'|'cm'|'mm';capabilities:string[];speedControl:boolean;zones:boolean;docking:boolean};
export const driverRegistry:Record<string,DriverProfile>={
 simulator:{targetKind:'ros',units:'m',capabilities:['delivery','bussing','guide'],speedControl:true,zones:true,docking:true},
 ros2:{targetKind:'ros',units:'m',capabilities:['delivery','bussing','guide'],speedControl:true,zones:true,docking:true},
 valetudo:{targetKind:'valetudo',units:'cm',capabilities:['delivery','guide'],speedControl:false,zones:false,docking:true},
};
const driverOf=(robot:JsonObject):DriverProfile|undefined=>Object.hasOwn(driverRegistry,String(robot.driver))?driverRegistry[String(robot.driver)]:undefined;
/**
 * R-W06-VALIDATION, the one dispatch-profile rule (eligibility and runtimeReadiness both use it): a simulator only as `simulated`, any other
 * driver only as `hardware_validated` or `venue_approved`; `integration_tested` is never dispatchable. Returns the reason, or undefined.
 */
export function profileReason(robot:JsonObject):string|undefined {
 if(!driverOf(robot)) return 'UNKNOWN_DRIVER';
 const ok=robot.driver==='simulator'?robot.validation==='simulated':['hardware_validated','venue_approved'].includes(String(robot.validation));
 return ok?undefined:'VALIDATION_INSUFFICIENT';
}
export const supports=(robot:JsonObject,capability:string):boolean=>Boolean(driverOf(robot)?.capabilities.includes(capability))&&((robot.capabilities ?? []) as string[]).includes(capability);
export const controlsSpeed=(robot:JsonObject):boolean=>Boolean(driverOf(robot)?.speedControl)&&robot.speedControl===true;
export const enforcesZones=(robot:JsonObject):boolean=>Boolean(driverOf(robot)?.zones)&&robot.zoneEnforcement===true;
