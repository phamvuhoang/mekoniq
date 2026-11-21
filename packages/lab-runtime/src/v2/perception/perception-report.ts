// The perception section of a run report (`report.perceptionEvidence`): what the belief streams of the run say, read back from the durable chunks (hot while the recorder is open, cold afterwards).
// Not a hot-state copy: a reader that sees a gap or a hash mismatch says so in `issues` and the Lab shows "no perception data" for it.
import type {BeliefRecord,GraspAttempt,RecoveryStep} from '../../../../contracts/generated/navigation2d';
import {readBeliefEvidence,readBeliefManifest} from './belief-evidence';
export interface PerceptionReportV1 {schemaVersion:1;/** every published estimate of the run (truthAtObservedTick/errorM are scoring data, only here) */beliefs:BeliefRecord[];/** one entry per attempt (the last record of an attemptId) in decision order */attempts:GraspAttempt[];recovery:RecoveryStep[];complete:boolean;issues:string[]}
/** `live` is the recorder of a run that is still going: its buffer is published first and the open tail is not a coverage issue. */
export async function buildPerceptionReport(directory:string,live?:{checkpoint():Promise<void>;manifest():unknown}):Promise<PerceptionReportV1>{
 const empty=(issues:string[]):PerceptionReportV1=>({schemaVersion:1,beliefs:[],attempts:[],recovery:[],complete:false,issues});
 try{
  if(live)await live.checkpoint();
  const read=await readBeliefEvidence(directory,live?live.manifest():await readBeliefManifest(directory));
  const issues=live?read.issues.filter(i=>i!=='BELIEF_COVERAGE_INCOMPLETE'):read.issues;
  return {schemaVersion:1,beliefs:read.beliefs,attempts:[...new Map(read.attempts.map(a=>[a.attemptId,a])).values()],recovery:read.recovery,complete:!live&&read.complete,issues};
 }catch(e){return empty([(e as NodeJS.ErrnoException).code==='ENOENT'?'BELIEF_EVIDENCE_MISSING':(e as Error).message]);}
}
