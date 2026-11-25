// Display model for the engineering part of a report. Old reports have none; a run that did not pass never shows metrics as if it had.
// Nothing here trusts the shape of a report: ids, levels and statuses come from closed sets, and anything else is shown as unsupported or not run.
import type {RunReport} from '../scenarios/controls';
export const CAPABILITY_IDS=['geometry','rigidBody','actuator','sensor','grasp','process','calibration'] as const;
export type Level='unsupported'|'modeled'|'verified';
export interface EngineeringView {
 status:'pass'|'fail'|'not_run';tone:'ok'|'fail'|'blocked';blockers:string[];showMetrics:boolean;
 capabilities:{id:typeof CAPABILITY_IDS[number];level:Level}[];ref:{bundleDigest:string;projectDigest:string}|null;
}
const TONE={pass:'ok',fail:'fail',not_run:'blocked'} as const;
const LEVELS=new Set<string>(['unsupported','modeled','verified']);
const DIGEST=/^[0-9a-f]{64}$/;
export function engineeringView(report:RunReport):EngineeringView|null {
 const a=report.engineeringEvidence;if(!a)return null;
 // an unknown status is the cautious one: it is never rendered as a pass
 const status=a.status==='pass'||a.status==='fail'||a.status==='not_run'?a.status:'not_run';
 const caps=(a.capabilities??{}) as Record<string,unknown>,ref=report.manifest.engineering;
 return {status,tone:TONE[status],blockers:status==='pass'?[]:Array.isArray(a.reasons)?a.reasons.map(String):[],showMetrics:status==='pass',
  capabilities:CAPABILITY_IDS.map(id=>({id,level:(typeof caps[id]==='string'&&LEVELS.has(caps[id] as string)?caps[id]:'unsupported') as Level})),
  ref:ref&&DIGEST.test(ref.bundleDigest)&&DIGEST.test(ref.projectDigest)?{bundleDigest:ref.bundleDigest,projectDigest:ref.projectDigest}:null};
}
