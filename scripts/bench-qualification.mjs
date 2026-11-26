// Bench qualification table (contracts §6): the cases and gates of the bench kit, which cases may be cut, and the gate outside the bench (G-SAFE1).
// A plain data module plus gateStatus, which the bench record uses to derive its gates from its case statuses; nothing here records or accepts anything.
const range=(p,a,b)=>Array.from({length:b-a+1},(_,i)=>`${p}${String(a+i).padStart(2,'0')}`);
export const GATES_BENCH={
 'G-KSW1':range('KSW',1,10),'G-KID1':range('KID',1,7),
 'G-KCF1':['KCF01','KCF02','KCF03','KCF04','KCF05','KCF06','KCF07a','KCF07b','KCF08','KCF09','KCF10'],
 'G-KMS1':range('KMS',1,6),'G-KCL1':range('KCL',1,5),'G-KSN1':range('KSN',1,7),'G-KTW1':range('KTW',1,5),'G-KREG1':range('KRG',1,3)
};
/** Each case, its gate; KTW06–KTW09 run only with B2.3 and count toward no gate. */
export const CASES_BENCH=Object.fromEntries([...Object.entries(GATES_BENCH).flatMap(([gate,ids])=>ids.map(id=>[id,{gate}])),...range('KTW',6,9).map(id=>[id,{gate:null,optional:true}])]);
/** `not_run` with a reason does not fail their gate (§6.2). */
export const CUTTABLE_BENCH=['KID06','KCF09','KMS03','KMS06'];
/** Outside the bench: `blocked_external` in every record, never derived from a case. */
export const EXTERNAL_GATES_BENCH={'G-SAFE1':'risk assessment, design and testing of safety functions by a qualified person, signed'};
/** The gates that need a bench session; a protocol_double record leaves them blocked_external. */
export const HARDWARE_GATES_BENCH=['G-KID1','G-KCF1','G-KMS1','G-KCL1','G-KSN1'];
/** tested: every case tested, a cuttable one may be not_run with a reason; failed: any case failed; not_run otherwise (unsupported_by_device included: fail closed). */
export function gateStatus(gateId,caseStatuses,{testLevel}){
 const ids=GATES_BENCH[gateId];
 if(!ids)throw Object.assign(new Error(`GATE_UNKNOWN ${gateId}`),{code:'GATE_UNKNOWN'});
 if(testLevel==='protocol_double'&&HARDWARE_GATES_BENCH.includes(gateId))return 'blocked_external';
 const s=ids.map(id=>[id,caseStatuses[id]]);
 if(s.some(([,c])=>c?.status==='failed'))return 'failed';
 return s.every(([id,c])=>c?.status==='tested'||CUTTABLE_BENCH.includes(id)&&c?.status==='not_run'&&!!c.reason)?'tested':'not_run';
}
