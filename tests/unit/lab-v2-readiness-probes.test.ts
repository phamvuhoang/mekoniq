import {afterEach,expect,test,vi} from 'vitest';
import {collectReadiness,canStartFromChecks} from '../../packages/lab-runtime/src/v2/readiness';
afterEach(()=>vi.useRealTimers());
test('a hung dependency becomes unknown and is aborted after the bounded probe deadline',async()=>{
 vi.useFakeTimers();let signal:AbortSignal|undefined;
 const result=collectReadiness({scenarioId:'FD01',backendSetId:'mock-amr'},{enabledBackends:['mock_amr'],probes:{world:async(_ctx,s)=>{signal=s;return new Promise(()=>{});}}});
 await vi.advanceTimersByTimeAsync(5000);const snapshot=await result;
 expect(snapshot.canStart).toBe(false);expect(snapshot.checks.find(c=>c.id==='probe:world')).toMatchObject({status:'unknown',reasonCodes:['PROBE_TIMEOUT']});expect(signal?.aborted).toBe(true);
});
test('expired, empty, and contradictory readiness checks never permit execution',async()=>{
 expect(canStartFromChecks([],false)).toBe(false);
 expect(canStartFromChecks([{id:'runner',status:'ready',reasonCodes:[],evidenceRef:null}],true)).toBe(false);
 const snapshot=await collectReadiness({scenarioId:'FD01',backendSetId:'mock-amr'},{enabledBackends:['mock_amr'],probes:{version:async()=>({status:'ready',reasonCodes:['PROTOCOL_MISMATCH'],evidenceRef:null})}});
 expect(snapshot.canStart).toBe(false);expect(snapshot.checks.find(c=>c.id==='probe:version')?.reasonCodes).toEqual(['PROBE_INVALID']);
});
test('unknown scenarios cannot execute provider probes supplied by an unrecognized request',async()=>{
 let calls=0;const snapshot=await collectReadiness({scenarioId:'__proto__',backendSetId:'mock-amr'},{enabledBackends:['mock_amr'],probes:{world:async()=>{calls++;return {status:'ready',reasonCodes:[],evidenceRef:null};}}});
 expect(snapshot.canStart).toBe(false);expect(calls).toBe(0);
});
