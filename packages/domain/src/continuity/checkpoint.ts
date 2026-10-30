export function checkpointClean(s:{loadedMissions:number;unknownGrants:number;missingDevices:number}) {
  return s.loadedMissions===0&&s.unknownGrants===0&&s.missingDevices===0;
}
export function deviceCheckpointComplete(checkpoint:import('../../../contracts/src/index').JsonObject|undefined,deviceEpoch:unknown,nowMs:number):boolean {
 if(!checkpoint||checkpoint.status!=='complete'||checkpoint.deviceEpoch!==deviceEpoch||checkpoint.pendingCount!==0||typeof checkpoint.expiresAtMs!=='number'||checkpoint.expiresAtMs<nowMs||checkpoint.expiresAtMs>nowMs+60000)return false;
 const {coveredSequence,receivedCursor,appliedCursor}=checkpoint;
 if([coveredSequence,receivedCursor,appliedCursor].some(value=>typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)))return false;
 return BigInt(String(receivedCursor))>=BigInt(String(coveredSequence))&&BigInt(String(appliedCursor))>=BigInt(String(coveredSequence));
}
