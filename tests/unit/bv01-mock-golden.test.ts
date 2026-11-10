// Pins the mock BV01 outcome before the arm plant is split (R1.1 D20): the default MockArmPlant mode must keep every byte of this run.
import {afterEach,expect,test} from 'vitest';
import {executeCoffee,cleanupRuns} from '../support/lab-v2';
import {outcomeDigest} from '../../packages/lab-runtime/src/v2/report';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
afterEach(cleanupRuns);
test('mock-default BV01 (seed 42) keeps its outcome digest and arm trace',async()=>{
 const r=await executeCoffee('BV01',{seed:42});
 expect(r.outcome.status).toBe('completed');expect(r.outcome.served).toBe('2');
 expect(outcomeDigest(r)).toBe('9cfda98a693941cde4e0ecbfe028d48471877c6f8440295fc26e7e5061a1a2a2');expect(hashJson(r.coffee!.armTrace.samples)).toBe('70ff6e4014be2e7db90b986aefc679fb00810ebaa813c3214bbf6a8f2e1beeff');
},60000);
