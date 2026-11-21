// V12 review fix: the rig's outcome of a fixed-program run and the contact count come from the run's report, not from a constant; the verifier recomputes them with the same function.
import {expect,test} from 'vitest';
import {rigReportFacts} from '../../packages/lab-runtime/src/v2/perception/pick-rig';
const rep=(o:{served?:string;status?:string;stop?:string;unexpected?:number})=>({outcome:{status:o.status??'needs_attention',served:o.served??'0'},coffee:{armTrace:o.stop?{stop:{reason:o.stop}}:{}},worldSweep:{nativeContacts:{status:'fail',unexpected:o.unexpected??0}}});
test('a served cup is lifted; a stop reason decides the rest; an ended run with no stop is a grip that did not form; a running one is unknown',()=>{
 expect(rigReportFacts(rep({served:'1',status:'running'}))).toEqual({fixedOutcome:'lifted',unexpectedContacts:0});
 expect(rigReportFacts(rep({stop:'CUP_DROPPED',unexpected:3}))).toEqual({fixedOutcome:'cup_dropped',unexpectedContacts:3});
 expect(rigReportFacts(rep({stop:'ARM_COLLISION'}))).toEqual({fixedOutcome:'unknown',unexpectedContacts:0});
 expect(rigReportFacts(rep({}))).toEqual({fixedOutcome:'grip_not_established',unexpectedContacts:0});
 expect(rigReportFacts(rep({status:'running'}))).toEqual({fixedOutcome:'unknown',unexpectedContacts:0});
 expect(rigReportFacts({outcome:{status:'completed',served:'0'}}).unexpectedContacts).toBe(0); // no world sweep section: no number is invented, it reads 0 only because none was reported
});
