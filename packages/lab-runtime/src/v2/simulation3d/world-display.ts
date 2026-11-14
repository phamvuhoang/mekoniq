/** One bounded, committed display observation. Read-only; never persisted in action receipts. */
import type {Sim3DSnapshotV1,LabWorldSceneV1} from '../navigation2d/contracts';
import type {WorldTickCommand} from './world-ports';
export type CommittedWorldDisplayCommand=Pick<WorldTickCommand,'targetTick'|'worldControl'|'velocities'>;
export interface WorldDisplay {version:1;runId:string;revision:number;tick:number;simTimeNs:string;availability:'valid'|'stale'|'unknown';reason:string|null;snapshot:Sim3DSnapshotV1|null;control:CommittedWorldDisplayCommand|null;controlReason:string|null}
export interface WorldDisplayScene {version:1;runId:string;availability:'available'|'unavailable';reason:string|null;scene:LabWorldSceneV1|null}
