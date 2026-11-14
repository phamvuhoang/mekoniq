import type {Sim3DSnapshotV1} from '../navigation2d/contracts';
import type {WorldPlantPorts} from './world-ports';
/** One attempt only. The caller owns serialization, durable pending intent and a terminal failure latch; this helper is never a retry boundary. */
export async function stepWorldOnce(port:WorldPlantPorts,tick:number,append:(snapshot:Sim3DSnapshotV1)=>Promise<void>):Promise<Sim3DSnapshotV1>{
 const command=port.prepareTick(tick+1);
 if(command.targetTick!==tick+1)throw new Error('WORLD_TARGET_TICK_INVALID');
 const snapshot=await port.step(command);
 if(snapshot.tick!==tick+1)throw new Error('WORLD_ACK_TICK_INVALID');
 await append(snapshot);
 await port.commit(snapshot);
 return snapshot;
}
