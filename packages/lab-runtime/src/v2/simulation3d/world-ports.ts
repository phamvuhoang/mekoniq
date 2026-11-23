import {driveWireCommand} from '../control/drive-run';
import {DRIVE_FAULTS} from '../control/drive-faults';
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
 worldPerturbations?:NonNullable<import('../../../../contracts/generated/navigation2d').WorldEvidenceRecord['command']>['worldPerturbations'];
 propPlacements:{propId:string;pose:{position:[number,number,number];quaternionXyzw:[number,number,number,number]}|null}[];
 /** Only with a virtual drive: the nine axis commands of the tick. The velocities and joint targets above are then the setpoints the controllers were given (kept as evidence, not sent). */
 driveCommands?:import('../control/drive-io').DriveCommandV1[];
 /** V08: every fault injection due on this tick (the intent; the worker is sent only those it applies) and, after the ACK, the receipts of the ones the runtime applied itself. */
 faultInjections?:import('../control/drive-faults').FaultInjection[];
 faultReceipts?:import('../control/drive-faults').FaultReceipt[];
}
/** The worker only receives native injections. Runtime fault receipts are appended after its ACK. */
export function worldWireCommand(command:WorldTickCommand,drive:boolean):WorldTickCommand{
 if(!drive)return command;
 const wire=driveWireCommand(command),worker=wire.faultInjections?.filter(e=>DRIVE_FAULTS[e.faultId as keyof typeof DRIVE_FAULTS].appliedBy==='worker');
 if(worker?.length)wire.faultInjections=worker;else delete wire.faultInjections;
 delete wire.faultReceipts;return wire;
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
 metadata?:Pick<import('../report').RunReport['manifest'],'models'|'profiles'|'armProgram'|'worldExtent'|'clock'|'drive'|'perception'>;
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
