import type {BundleReceipt,EngineeringCandidate,EngineeringProject,Problem} from '../shared/engineering';
import type {RunReport} from '../scenarios/controls';
import {hashJson} from '../twin/hash';

type Ref=EngineeringCandidate['evidenceRefs'][number];
type Historical=EngineeringCandidate['historicalEvidenceRefs'][number];
const engineeringOf=(r:RunReport)=>(r.manifest as {engineering?:{bundleDigest:string;projectDigest:string}}).engineering;
/**
 * Exports exactly the draft in hand. A receipt for a different draft is an error, never quietly reused; a missing or blocked receipt still exports with null digests and the blockers.
 * Evidence counts as current only when its project and bundle digests are this draft's; everything else is kept as history with the reason and adds no readiness.
 */
export async function buildEngineeringCandidate(project:EngineeringProject,receipt:BundleReceipt|null,reports:RunReport[]):Promise<EngineeringCandidate> {
  const projectDigest=hashJson(project);
  if (receipt&&receipt.projectDigest!==projectDigest) throw new Error('ENGINEERING_IDENTITY_MISMATCH');
  const compiled=receipt?.state==='compiled'?receipt:null;
  const problems:Problem[]=receipt?[...receipt.problems]:[{code:'BUNDLE_NOT_COMPILED',path:'/',blocking:true,detail:'No compile receipt exists for this draft'}];
  const evidenceRefs:Ref[]=[],historicalEvidenceRefs:Historical[]=[];
  for (const report of reports) {
    const eng=engineeringOf(report),runId=String((report.manifest as {runId?:string}).runId??'unknown');
    const ref={runId,reportDigest:hashJson(report),projectDigest:eng?.projectDigest??'0'.repeat(64),bundleDigest:eng?.bundleDigest??'0'.repeat(64)};
    if (!eng) historicalEvidenceRefs.push({...ref,reason:'NOT_ENGINEERING_EVIDENCE'});
    else if (compiled&&eng.projectDigest===projectDigest&&eng.bundleDigest===compiled.bundleDigest) evidenceRefs.push(ref);
    else historicalEvidenceRefs.push({...ref,reason:eng.projectDigest!==projectDigest?'PROJECT_CHANGED':'BUNDLE_CHANGED'});
  }
  const body={documentType:'engineering-candidate' as const,schemaVersion:1 as const,status:'draft' as const,hardwareValidated:false as const,controlAuthority:false as const,project:structuredClone(project),projectDigest,
    assemblyDigest:compiled?.assemblyDigest??null,bundleDigest:compiled?.bundleDigest??null,problems,evidenceRefs,historicalEvidenceRefs};
  return {...body,checksum:hashJson(body)};
}
