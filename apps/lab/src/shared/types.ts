export type Locale = 'vi' | 'ja' | 'en';
export interface RobotDesign { id:string; revision:number; chassis:'service'|'valetudo'; trays:number; batteryAh:number; sensor:'lidar'|'depth'; payloadKg:number; }
export interface WorldPoint {id:string;name:string;kind:'table'|'kitchen'|'parking'|'dock';x:number;y:number;}
export interface Obstacle {id:string;x:number;y:number;width:number;height:number;}
export interface RestaurantWorld {id:string;revision:number;width:number;height:number;points:WorldPoint[];obstacles:Obstacle[];}
export interface LabProject {schemaVersion:1;id:string;name:string;revision:number;updatedAt:string;design:RobotDesign;world:RestaurantWorld;}
export interface Issue {code:string;field:string;message:string;}
export interface BomLine {id:string;name:string;quantity:number;massKg:number;priceMinor:string|null;currency:'VND';provenance:'illustrative';}
export interface DesignSummary {lines:BomLine[];totalMinor:string|null;missingIds:string[];massKg:number|null;usableWh:number|null;runtimeHours:number|null;issues:Issue[];}
export type RunStatus='ready'|'running'|'awaiting_load'|'awaiting_handoff'|'completed'|'cancelled'|'needs_attention';
export interface RunEvent {type:string;at:string;[key:string]:unknown;}
export interface RunSnapshot {id:string;mode:'business_sim';status:RunStatus;stage:'idle'|'to_kitchen'|'load'|'to_table'|'handoff'|'to_parking'|'finished';revision:number;robotPosition:{x:number;y:number};target:{x:number;y:number}|null;served:string;loaded:boolean;events:RunEvent[];elapsedMs:number;sourceCommit:string;scenarioId:string;seed:number;[key:string]:unknown;}
// TODO(interim-copy): the v2 types below are hand-mirrored from source/packages/contracts/generated/lab-v2.ts (the Lab consumes the source artifact, not its TS); replace with the pinned artifact or a generated import.
// Guarding: the v1 types above (LabProject, RobotDesign, WorldPoint, Obstacle, RestaurantWorld) are compared structurally with source LabProjectV1 by source tests/integration/lab-v2-model.test.ts. AssetRevision and LabProjectV2 are NOT text-guarded; only the source test that validates the Lab twin fixtures against the real schemas and hashes covers them, indirectly.
export type PointKindV2=WorldPoint['kind']|'coffee_pickup';
export interface AssetRevision {schemaVersion:2;id:string;revision:number;contentHash:string;hashAlgorithm:'sha256-canonical-json-v1';kind:'amr'|'arm'|'coffee_machine'|'fixture'|'cup'|'sensor'|'tool';
 visual:{contentHash:string;mediaType:string}|null;collision:{contentHash:string;mediaType:string}|null;
 frames:{id:string;parentId:string|null;translationM:number[];quaternionXyzw:number[]}[];
 geometry:({kind:'box';frameId:string;sizeM:number[]}|{kind:'cylinder';frameId:string;radiusM:number;heightM:number}|{kind:'sphere';frameId:string;radiusM:number})[];
 kinematics?:{convention:'modified_dh'|'urdf';jointCount:number};inertial?:{massKg:number};sensorRefs?:string[];toolRefs?:string[];
 provenance:{parameter:string;source:'measured'|'vendor_spec'|'vendor_cad'|'assumed'|'illustrative';reference?:string;license?:string}[];}
export interface LabProjectV2 {faultSchedule?:import('../scenarios/fault-schedule').FaultScheduleEntry[];schemaVersion:2;id:string;name:string;revision:number;updatedAt:string;
 armCollisionProfile?:{schemaVersion:1;id:string;revision:number;units:'SI';provenance:'illustrative';reference:string;modelId:string;modelRevision:string;
  baseInMap:{position:number[];quaternionXyzw:number[]};fixtureHeightM:number;robotHeightM:number};
 entities:{id:string;speedLimitMps?:number;kind:'amr'|'arm'|'coffee_machine'|'cup_station';assetRef:{id:string;revision:number;contentHash:string};recipeRefs?:{id:string;revision:number;hash:string}[]}[];
 world:{id:string;revision:number;width:number;height:number;points:{id:string;name:string;kind:PointKindV2;x:number;y:number}[];handoffPoints?:{id:string;name:string;kind:PointKindV2;position:number[];yawRad:number|null}[];obstacles:Obstacle[]};}
