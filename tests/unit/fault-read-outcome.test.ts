import {expect,test} from 'vitest';
import {faultReadOutcome} from '../../packages/lab-runtime/src/v2/simulation3d/world-drive-report';
const report={documentType:'fault-report'} as never;
test('a fault report read is its report, or the reasons it could not be made: never silence',async()=>{
 expect(await faultReadOutcome(async()=>report)).toEqual({report,issues:[]});
 expect(await faultReadOutcome(async()=>{throw new Error('FAULT_EVIDENCE_INVALID:RECEIPT_MISSING:12/e/start');})).toEqual({issues:['FAULT_EVIDENCE_INVALID:RECEIPT_MISSING:12/e/start']});
 expect(await faultReadOutcome(async()=>undefined)).toEqual({issues:['FAULT_REPORT_UNAVAILABLE']});
 const e=Object.assign(new Error('x'),{code:'ENOENT'});
 expect(await faultReadOutcome(async()=>{throw e;})).toEqual({issues:['WORLD_RETAINED_BUNDLE_UNAVAILABLE']});
});
