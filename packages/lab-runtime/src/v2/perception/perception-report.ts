// The perception section of a run report (`report.perceptionEvidence`): what the belief streams of the run say, read back from the durable chunks (hot while the recorder is open, cold afterwards).
// Not a hot-state copy: a reader that sees a gap or a hash mismatch says so in `issues` and the Lab shows "no perception data" for it.
import type {BeliefEvidenceManifestV1,BeliefRecord,GraspAttempt,RecoveryStep} from '../../../../contracts/generated/navigation2d';
import {readBeliefEvidence,readBeliefManifest} from './belief-evidence';
import type {RunReport} from '../report';
import {matchesGraspProgramRecord} from './grasp-programs';
const empty=(issues:string[]):PerceptionReportV1=>({schemaVersion:1,beliefs:[],attempts:[],attemptRecords:[],recovery:[],complete:false,issues});
export interface PerceptionReportV1 {schemaVersion:1;/** Only for an explicitly selected program, read from the belief manifest for replay identity checks. */graspProgramDigest?:string;/** every published estimate of the run (truthAtObservedTick/errorM are scoring data, only here) */beliefs:BeliefRecord[];/** one entry per attempt (the last record of an attemptId) in decision order */attempts:GraspAttempt[];/** every attempt record in the order written: plan, commit, outcome, each with the tick it was written (`recordedTick`, `stage`) */attemptRecords:GraspAttempt[];recovery:RecoveryStep[];complete:boolean;issues:string[]}
/** `live` is the recorder of a run that is still going: its buffer is published first and the open tail is not a coverage issue. */
/** `identity`: what the run being reported is (any of the manifest's identity fields); evidence that says otherwise is `BELIEF_IDENTITY_MISMATCH`, never merged into this run. */
export async function buildPerceptionReport(directory:string,live?:{checkpoint():Promise<void>;manifest():unknown},identity?:Partial<BeliefEvidenceManifestV1['identity']>):Promise<PerceptionReportV1>{
 try{
  if(live)await live.checkpoint();
  const manifest=live?live.manifest():await readBeliefManifest(directory),read=await readBeliefEvidence(directory,manifest,{identity});
  const digest=(manifest as BeliefEvidenceManifestV1|undefined)?.identity?.graspProgramDigest;
  const issues=live?read.issues.filter(i=>i!=='BELIEF_COVERAGE_INCOMPLETE'):read.issues;
  return {schemaVersion:1,...typeof digest==='string'?{graspProgramDigest:digest}:{},beliefs:read.beliefs,attempts:[...new Map(read.attempts.map(a=>[a.attemptId,a])).values()],attemptRecords:read.attempts,recovery:read.recovery,complete:!live&&read.complete,issues};
 }catch(e){return empty([(e as NodeJS.ErrnoException).code==='ENOENT'?'BELIEF_EVIDENCE_MISSING':(e as Error).message]);}
}
/** A cold run supplies its complete expected configuration, including explicit absence of a selected program. */
export async function buildRetainedPerceptionReport(directory:string,manifest:Pick<RunReport['manifest'],'seed'|'perception'|'graspProgramId'|'armProgram'>,identity:Pick<BeliefEvidenceManifestV1['identity'],'runId'|'bootId'|'sceneDigest'>):Promise<PerceptionReportV1>{
 const pm=manifest.perception;if(!pm)return empty(['BELIEF_EVIDENCE_MISSING']);
 if(!matchesGraspProgramRecord(manifest.graspProgramId,pm.program,manifest.armProgram))return empty(['GRASP_PROGRAM_IDENTITY_MISMATCH']);
 return buildPerceptionReport(directory,undefined,{...identity,perceptionProfileDigest:pm.profile.digest,recoveryPolicyDigest:pm.recoveryPolicy?.digest??null,graspProgramDigest:pm.program?.executionDigest,graspMode:pm.graspMode,seed:manifest.seed});
}
