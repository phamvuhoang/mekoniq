export function checkpointClean(s:{loadedMissions:number;unknownGrants:number;missingDevices:number}) {
  return s.loadedMissions===0&&s.unknownGrants===0&&s.missingDevices===0;
}
