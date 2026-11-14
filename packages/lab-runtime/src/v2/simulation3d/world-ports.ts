import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {RobotAdapter} from '../../../../robot-adapters/src/contract';
import type {CoffeePlantPorts} from '../beverage/coffee-ports';
import type {CoffeeState,CoffeeContext} from '../scenarios/coffee';
import type {RunManifestInput} from '../scenario-runner';
export interface WorldTickCommand {
 targetTick:number;
 velocities:{robotId:string;vMps:number;omegaRadps:number}[];
 actorUpdates:{actorId:string;poseMap:[number,number,number]}[];
 jointTargets:{armId:string;positionsRad:number[]}[];
 gripperTargets:{armId:string;openingM:number}[];
 worldInteractions?:{eventId:string;cupId:string;propId:string;kind:'birth'|'remove';targetTick:number}[];
 propPlacements:{propId:string;pose:{position:[number,number,number];quaternionXyzw:[number,number,number,number]}|null}[];
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
 navigation?:import('../session').SourceFixture['navigation'];
 metadata?:Pick<import('../report').RunReport['manifest'],'models'|'profiles'|'armProgram'>;
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
