import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {designHint,trayHint,trayHintHtml,type TraySummary} from '../../src/reports/design-hint';
import {report} from '../support/navigation-report';

const run=(id:string,a:number,slipM:number|null,timeS:number|null):TraySummary=>({experimentId:id,accelerationLimitMps2:a,maxLoadSlipM:{available:slipM!==null,value:slipM},serviceTimeS:{available:timeS!==null,value:timeS}});
const low=run('tray-low-friction-v1',0.5,0.0012,112.7),high=run('tray-accel-high-v1',2.5,0.0431,98.4);
const pair=(over:Record<string,unknown>={})=>({accepted:true,changed:['acceleration'],a:low,b:high,...over}) as never;
beforeEach(()=>setLocale('en'));

test('an accepted pair that differs in the acceleration limit gets one sentence with every measured number',()=>{
 const h=designHint(pair());if(!h.available)throw new Error(h.reason);
 for(const n of ['2.5','0.5','43.1','1.2','98.4','112.7'])expect(h.text,n).toContain(n);
 expect(h.text).toMatch(/not calibrated|uncalibrated/i);expect(h.text).toMatch(/physical test/i);
 expect(h.text).toMatch(/decreas/i);                     // reducing the limit decreases the largest slip ...
 expect(h.text).toMatch(/increas/i);                     // ... and increases the service time
});

test('the order of the two runs does not change the sentence: it always goes from the higher limit to the lower',()=>{
 const x=designHint(pair()),y=designHint(pair({a:high,b:low}));
 expect(x).toEqual(y);
});

test('the direction words follow the numbers, never the expectation',()=>{
 const slower=designHint(pair({b:run('tray-accel-high-v1',2.5,0.0005,98.4)}));if(!slower.available)throw new Error('unreachable');
 expect(slower.text).toMatch(/increas/i);expect(slower.text).not.toMatch(/decreas.*slip/i);
 const same=designHint(pair({b:run('tray-accel-high-v1',2.5,0.0012,112.7)}));if(!same.available)throw new Error('unreachable');
 expect(same.text).toMatch(/unchanged/i);
});

test('not accepted, another input changed, no change in the limit or a missing metric gives no sentence and a reason',()=>{
 expect(designHint(pair({accepted:false}))).toEqual({available:false,reason:'PAIR_NOT_ACCEPTED'});
 expect(designHint(pair({changed:['friction']}))).toEqual({available:false,reason:'CHANGED_INPUT_NOT_ACCELERATION'});
 expect(designHint(pair({changed:['acceleration','friction']}))).toEqual({available:false,reason:'CHANGED_INPUT_NOT_ACCELERATION'});
 expect(designHint(pair({b:run('tray-accel-high-v1',0.5,0.04,98)}))).toEqual({available:false,reason:'ACCELERATION_LIMIT_EQUAL'});
 expect(designHint(pair({b:run('tray-accel-high-v1',2.5,null,98)}))).toEqual({available:false,reason:'METRIC_UNAVAILABLE'});
 expect(designHint(pair({a:run('tray-low-friction-v1',0.5,0.001,null)}))).toEqual({available:false,reason:'METRIC_UNAVAILABLE'});
 expect(designHint(pair({a:{...low,maxLoadSlipM:{available:true,value:Number.NaN}}}))).toEqual({available:false,reason:'METRIC_UNAVAILABLE'});
});

test('the sentence never says optimal and carries no percentile: it is one run on each side',()=>{
 const h=designHint(pair());if(!h.available)throw new Error('unreachable');
 expect(h.text).not.toMatch(/optimal|best|p50|p95/i);
});

for(const [locale,limit,warning] of [['vi','giới hạn gia tốc','thử nghiệm vật lý'],['ja','加速度','物理試験'],['en','acceleration limit','physical test']] as const){
 test(`${locale}: the sentence and its closing warning are in the language`,()=>{
  setLocale(locale);
  const h=designHint(pair());if(!h.available)throw new Error('unreachable');
  expect(h.text).toContain(limit);expect(h.text).toContain(warning);
  for(const n of ['2.5','0.5','43.1','1.2','98.4','112.7'])expect(h.text,n).toContain(n);
 });
}

// ---- from two run reports ----
const knobs=(over:Record<string,unknown>={})=>({friction:'cup-triple-low-friction',acceleration:'nominal',drive:'drive-nominal-v1',actor:false,...over});
const evidence=(over:Record<string,unknown>={})=>({schemaVersion:1,documentType:'tray-evidence',accepted:false,calibration:'not_calibrated',experimentId:'tray-low-friction-v1',comparedWith:'tray-nominal-v1',knobs:knobs(),accelerationLimitMps2:0.5,windowTicks:25,
 maxLoadSlipM:{available:true,value:0.0012},cumulativeDriftM:0.04,maxSupportAccelerationMps2:0.5,serviceTimeS:{available:true,value:112.7},policyDigest:'p'.repeat(64),...over});
const tray=(ev:unknown,over:Record<string,unknown>={})=>report({manifest:{...report().manifest,scenario:{id:'MJ-TRAY01',revision:1,hash:'h'},seed:7,backendSetId:'engineering-mujoco-3d-v1',...over},trayEvidence:ev});
const slow=()=>tray(evidence()),fast=()=>tray(evidence({experimentId:'tray-accel-high-v1',comparedWith:'tray-low-friction-v1',knobs:knobs({acceleration:'high'}),accelerationLimitMps2:2.5,maxLoadSlipM:{available:true,value:0.0431},serviceTimeS:{available:true,value:98.4}}));

test('two tray reports that differ only in the acceleration give the sentence, whichever is first',()=>{
 for(const [a,b] of [[slow(),fast()],[fast(),slow()]] as const){
  const h=trayHint(a,b);if(!h.available)throw new Error(h.reason);
  for(const n of ['2.5','0.5','43.1','1.2','98.4','112.7'])expect(h.text,n).toContain(n);
 }
});

test('a report without tray evidence, or with malformed evidence, says so',()=>{
 expect(trayHint(slow(),report())).toEqual({available:false,reason:'NO_TRAY_EVIDENCE'});
 expect(trayHint(slow(),tray({...evidence(),documentType:'x'}))).toEqual({available:false,reason:'NO_TRAY_EVIDENCE'});
 expect(trayHint(slow(),tray(evidence({maxLoadSlipM:null})))).toEqual({available:false,reason:'NO_TRAY_EVIDENCE'});
 expect(trayHint(slow(),tray(evidence({knobs:null})))).toEqual({available:false,reason:'NO_TRAY_EVIDENCE'});
});

test('the pair must be the same scenario, seed, backend set and thresholds, and may differ only in the acceleration',()=>{
 expect(trayHint(slow(),tray(fast().trayEvidence,{seed:8}))).toEqual({available:false,reason:'PAIR_NOT_ACCEPTED'});
 expect(trayHint(slow(),tray((fast().trayEvidence as {policyDigest:string}&object),{backendSetId:'other'}))).toEqual({available:false,reason:'PAIR_NOT_ACCEPTED'});
 expect(trayHint(slow(),tray({...fast().trayEvidence as object,policyDigest:'q'.repeat(64)}))).toEqual({available:false,reason:'PAIR_NOT_ACCEPTED'});
 expect(trayHint(slow(),tray(evidence({experimentId:'tray-nominal-v1',comparedWith:null,knobs:knobs({friction:'cup-triple'})})))).toEqual({available:false,reason:'CHANGED_INPUT_NOT_ACCELERATION'});
 expect(trayHint(slow(),tray(evidence({knobs:knobs({friction:'cup-triple',acceleration:'high'}),accelerationLimitMps2:2.5})))).toEqual({available:false,reason:'CHANGED_INPUT_NOT_ACCELERATION'});
});

test('a run that did not finish has no service time, so there is no sentence',()=>{
 const unfinished=tray(evidence({experimentId:'tray-accel-high-v1',knobs:knobs({acceleration:'high'}),accelerationLimitMps2:2.5,serviceTimeS:{available:false,value:null,reason:'MISSION_NOT_COMPLETED'}}));
 expect(trayHint(slow(),unfinished)).toEqual({available:false,reason:'METRIC_UNAVAILABLE'});
});

// ---- the panel's block ----
test('the compare panel shows the sentence, or the reason there is none, only when a tray report is involved',()=>{
 expect(trayHintHtml(report(),report())).toBe('');
 const ok=trayHintHtml(slow(),fast());expect(ok).toContain('data-testid="tray-hint"');expect(ok).toContain('data-available="true"');expect(ok).toContain('2.5');expect(ok).not.toContain('<script');
 const no=trayHintHtml(slow(),tray(evidence({maxLoadSlipM:{available:false,value:null}}),{seed:8}));
 expect(no).toContain('data-available="false"');expect(no).toContain('PAIR_NOT_ACCEPTED');expect(no).toMatch(/not enough data to compare/i);
 expect(trayHintHtml(slow(),report())).toContain('NO_TRAY_EVIDENCE');
});
test('the reason is in the language, and the code stays beside it',()=>{
 setLocale('vi');expect(trayHintHtml(slow(),report())).toContain('Không đủ dữ liệu để so sánh');
 setLocale('ja');expect(trayHintHtml(slow(),report())).toContain('比較');
});
