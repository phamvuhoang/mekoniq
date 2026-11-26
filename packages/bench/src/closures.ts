// Checklist closures (spec B1 §7.2): each R5 checklist row of the kit that a bench case can settle gets the case's answer; every other row stays not_measured.
import type {CaseVerdict} from './cases/types';
import type {BenchKitV1,BenchRecordV1} from './contracts';

/** Rule id -> the identity case that measures it. */
export const CLOSING_CASES:Readonly<Record<string,string>>={UNVERIFIED_FIRMWARE:'KID02',UNVERIFIED_BUS_EXPOSURE:'KID03'};
/** tested: confirmed; failed: contradicted (the device disagrees with its documents); anything else, or no case: not_measured. `observed` is what the case read at
 * that checklist path (CaseVerdict.observed). */
export function closuresFor(checks:{ruleId:string;path:string;detail:string}[],results:Map<string,CaseVerdict>,_kit:BenchKitV1):BenchRecordV1['closures']{
 return checks.map(({ruleId,path})=>{
  const caseId=Object.hasOwn(CLOSING_CASES,ruleId)?CLOSING_CASES[ruleId]!:null,v=caseId?results.get(caseId):undefined;
  const result=v?.status==='tested'?'confirmed':v?.status==='failed'?'contradicted':'not_measured';
  return {ruleId,path,result,caseId,observed:result==='not_measured'?null:v?.observed?.[path]??null};
 });
}
