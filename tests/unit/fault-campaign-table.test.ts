import {expect,test} from 'vitest';
import {FAULT_CASES,campaignCoverage,verifyFaultCampaign} from '../../packages/lab-runtime/src/v2/control/fault-campaign';
import {faultStartTick} from '../../packages/lab-runtime/src/v2/control/drive-faults';

test('the locked table covers every catalog fault, every schedule is admissible, and there are at least 16 runs',()=>{
 const {coverage,problems}=campaignCoverage();
 expect(problems).toEqual([]);expect(FAULT_CASES.length).toBeGreaterThanOrEqual(16);
 expect(coverage.every(c=>c.runs>=1)).toBe(true);
});
test('removing a run or a target breaks the coverage rule instead of passing quietly',()=>{
 expect(campaignCoverage(FAULT_CASES.filter(c=>!/^(m02|c03)/.test(c.id))).problems).toContain('FLT_COVERAGE:encoder-dropout');   // one run, one target left
 expect(campaignCoverage(FAULT_CASES.filter(c=>!c.schedule.some(e=>e.faultId==='drive-reset'))).problems).toContain('FLT_COVERAGE:drive-reset');
 expect(campaignCoverage(FAULT_CASES.slice(0,10)).problems).toContain('FLT_RUNS_BELOW_16');
 const bad=structuredClone(FAULT_CASES);bad[0]!.schedule[0]!.durationMs=10;
 expect(campaignCoverage(bad).problems.some(p=>p.startsWith('FLT_SCHEDULE:'))).toBe(true);
});
test('the required faults fire during the cruise of the mission and the not-fired entry is past any run',()=>{
 for(const c of FAULT_CASES.filter(c=>c.kind==='mobile'&&/^m0[1-6]/.test(c.id)))expect(faultStartTick((c.schedule[0]!.trigger as {value:number}).value)).toBeGreaterThan(449);   // the first cruise of the baseline mission is ticks 449..1034
 expect(faultStartTick((FAULT_CASES.find(c=>c.id==='m14-not-fired')!.schedule[0]!.trigger as {value:number}).value)).toBeGreaterThan(30000);
});
test('a campaign directory that is not a campaign is refused with its own code',async()=>{
 expect((await verifyFaultCampaign('/nonexistent-fault-campaign')).issues).toContain('FLT_CAMPAIGN_IDENTITY');
});
