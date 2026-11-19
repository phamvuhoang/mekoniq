import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {RobotAdapter} from '../../../../robot-adapters/src/contract';
import type {CoffeePlantPorts} from '../beverage/coffee-ports';
import type {CoffeeState,CoffeeContext} from '../scenarios/coffee';
import type {RunManifestInput} from '../scenario-runner';
export type WorldControl=import('../../../../contracts/generated/navigation2d').WorldControlV1;
export interface WorldTickCommand {
 worldControl?:WorldControl;
 targetTick:number;
 velocities:{robotId:string;vMps:number;omegaRadps:number}[];
 actorUpdates:{actorId:string;poseMap:[number,number,number]}[];
 jointTargets:{armId:string;positionsRad:number[]}[];
 gripperTargets:{armId:string;openingM:number}[];
 worldInteractions?:{eventId:string;cupId:string;propId:string;kind:'birth'|'remove';targetTick:number}[];
 worldPerturbations?:{eventId:string;presetId:'world-dock-drift-v1'|'world-cup-fall-v1';revision:1;targetId:string;targetTick:number}[];
 propPlacements:{propId:string;pose:{position:[number,number,number];quaternionXyzw:[number,number,number,number]}|null}[];
 /** Only with a virtual drive: the nine axis commands of the tick. The velocities and joint targets above are then the setpoints the controllers were given (kept as evidence, not sent). */
 driveCommands?:import('../control/drive-io').DriveCommandV1[];
}
/** Preparation cannot publish observations. The shared engine advances only in step; commit consumes a validated, durably recorded ACK. */
export interface WorldPlantPorts {
 prepareTick(nextTick:number):WorldTickCommand;
 step(command:WorldTickCommand):Promise<Sim3DSnapshotV1>;
 commit(observation:Sim3DSnapshotV1):Promise<void>;
 close():Promise<void>;
}
export interface WorldFailure {targetTick:number;lastCommittedTick:number;ackTick:number|null;reason:string}
export interface WorldEvidence {append(snapshot:Sim3DSnapshotV1):Promise<void>;fail(failure:WorldFailure):Promise<void>;finish():Promise<void>}
export interface WorldPlantBindings {
 displayScene?():import('../navigation2d/contracts').LabWorldSceneV1;
 navigation?:import('../session').SourceFixture['navigation'];
 metadata?:Pick<import('../report').RunReport['manifest'],'models'|'profiles'|'armProgram'|'worldExtent'|'clock'|'drive'>;
 evidence:WorldEvidence;
 world:WorldPlantPorts;
 robots:ReadonlyMap<string,RobotAdapter>;
 coffee:CoffeePlantPorts;
 snapshot():Sim3DSnapshotV1;
}
export interface WorldFactoryInput {
 manifest:RunManifestInput;runId:string;directory:string;state:CoffeeState;context:CoffeeContext;newBootId():string;
}
export type WorldPortsFactory=(input:WorldFactoryInput)=>Promise<WorldPlantBindings>;
