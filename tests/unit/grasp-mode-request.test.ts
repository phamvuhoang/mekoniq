import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {cellPreset} from '../../src/twin/cell';
import {requestForPreset} from '../../src/scenarios/controls';
const body=(graspMode?:'fixed_program'|'belief_ground_truth'|'belief_estimated')=>requestForPreset({...cellPreset(),...graspMode?{graspMode}:{}}) as unknown as Record<string,unknown>;
test('the fixed program (the default) sends nothing new: the R2b request, byte for byte',()=>{
 for(const r of [body(),body('fixed_program')]){expect('graspMode' in r).toBe(false);expect('perceptionProfileId' in r).toBe(false);}
});
test('ground truth names the mode only; the estimate also names the registered nominal profile (ids, never values)',()=>{
 expect(body('belief_ground_truth')).toMatchObject({graspMode:'belief_ground_truth'});expect('perceptionProfileId' in body('belief_ground_truth')).toBe(false);
 expect(body('belief_estimated')).toMatchObject({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'});
});
