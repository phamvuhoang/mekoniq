import {expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {compatibleProgram,compatibleExperiment,TWO_STAGE,CUP_NUDGE} from '../../src/twin/cell-selection';
import type {TwinHealth} from '../../src/scenarios/controls';
import {cellPreset} from '../../src/twin/cell';
import {requestForPreset} from '../../src/scenarios/controls';
const preset=cellPreset();
const mode={id:'belief_estimated',recoveryPolicyIds:['pick-recovery-v1'],profileIds:['perception-nominal-v1'],programIds:[TWO_STAGE]};
const experiment={id:CUP_NUDGE,requiresNewRun:true,graspProgramId:TWO_STAGE,graspModes:['belief_estimated','belief_ground_truth']};
const h={capabilities:['sim3d_world_experiments_v1','sim3d_belief_grasp_v1'],graspModes:[mode,{...mode,id:'belief_ground_truth'}],worldExperiments:[experiment],
 scenarioIds:[preset.scenarioId],scenarioRequirementsByBackendSet:{[preset.scenarioId]:{[preset.backendSetId]:{supported:true,required:[],reasonCodes:[]}}},
 backendSets:[{id:preset.backendSetId,mode:'simulation',access:'simulated',backends:[]},{id:'mock-default',mode:'mock',access:'simulated',backends:[]}]} as unknown as TwinHealth;
const body=(graspMode?:'fixed_program'|'belief_ground_truth'|'belief_estimated')=>requestForPreset({...cellPreset(),...graspMode?{graspMode}:{}}) as unknown as Record<string,unknown>;
test('the fixed program (the default) sends nothing new: the R2b request, byte for byte',()=>{
 for(const r of [body(),body('fixed_program')]){expect('graspMode' in r).toBe(false);expect('perceptionProfileId' in r).toBe(false);}
});
test('ground truth names the mode only; the estimate also names the registered nominal profile (ids, never values)',()=>{
 expect(body('belief_ground_truth')).toMatchObject({graspMode:'belief_ground_truth'});expect('perceptionProfileId' in body('belief_ground_truth')).toBe(false);
 expect(body('belief_estimated')).toMatchObject({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'});
});
test('a belief mode also names the registered recovery policy (an id); the fixed program names none',()=>{
 expect(body('belief_ground_truth')).toMatchObject({graspMode:'belief_ground_truth',recoveryPolicyId:'pick-recovery-v1'});
 expect(body('belief_estimated')).toMatchObject({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1'});
 for(const r of [body(),body('fixed_program')])expect('recoveryPolicyId' in r).toBe(false);
 expect(JSON.stringify(body('belief_estimated'))).not.toMatch(/maxAttempts|steps|rules/);
});

test('the registered nudge needs a belief mode and the two-stage program on the ordinary drive',()=>{
 const p={...cellPreset(),worldExperimentId:'world-cup-nudge-v2' as const,graspProgramId:'cup-pick-two-stage-v1' as const};
 for(const graspMode of ['belief_ground_truth','belief_estimated'] as const){
  const r=requestForPreset({...p,graspMode},[],h);expect(r).toMatchObject({worldExperimentId:p.worldExperimentId,graspProgramId:p.graspProgramId,recoveryPolicyId:'pick-recovery-v1'});expect(r).not.toHaveProperty('driveExperimentId');
 }
 expect(()=>requestForPreset({...p,graspMode:'fixed_program'})).toThrow();
 expect(()=>requestForPreset({...p,graspMode:'belief_estimated',graspProgramId:undefined})).toThrow();
});

test('catalog compatibility requires all advertised IDs, including policy and the experiment mode',()=>{
 const p={...cellPreset(),graspMode:'belief_estimated' as const,graspProgramId:TWO_STAGE,worldExperimentId:CUP_NUDGE} as const;
 expect(compatibleExperiment(h,p,CUP_NUDGE)).toBe(true);
 for(const missing of [null,{...h,capabilities:[]},{...h,graspModes:[]},{...h,graspModes:[{...mode,programIds:undefined}]},{...h,graspModes:[{...mode,recoveryPolicyIds:[]}]},{...h,graspModes:[{...mode,profileIds:[]}]}]){
  expect(compatibleProgram(missing,p)).toBe(false);expect(compatibleExperiment(missing,p,CUP_NUDGE)).toBe(false);
 }
 for(const worldExperiments of [[],[{...experiment,graspProgramId:undefined}],[{...experiment,graspModes:[]}]])expect(()=>requestForPreset(p,[],{...h,worldExperiments})).toThrow();
 const base=cellPreset(),legacy=JSON.stringify({project:base.project,worldExperimentId:base.worldExperimentId,scenarioId:base.scenarioId,scenarioRevision:base.scenarioRevision,seed:base.seed,mode:base.mode,backendSetId:base.backendSetId,access:'simulated'});
 expect(JSON.stringify(requestForPreset(base))).toBe(legacy);expect(JSON.stringify(requestForPreset({...base,graspMode:'fixed_program'}))).toBe(legacy);
});

test('recovery selections require a health-advertised scenario and cell backend in simulation',()=>{
 const selected={...preset,graspMode:'belief_estimated',graspProgramId:TWO_STAGE,worldExperimentId:CUP_NUDGE} as const;
 for(const p of [{...selected,backendSetId:'mock-default'},{...selected,mode:'mock' as const},{...selected,scenarioId:'BV01'},{...selected,scenarioRevision:2}]){
  expect(compatibleProgram(h,p)).toBe(false);expect(compatibleExperiment(h,p,CUP_NUDGE)).toBe(false);
  expect(()=>requestForPreset(p,[],h)).toThrow();
 }
 for(const health of [undefined,{...h,backendSets:[]},{...h,scenarioIds:[]},{...h,scenarioRequirementsByBackendSet:{}},{...h,scenarioRequirementsByBackendSet:{[preset.scenarioId]:{[preset.backendSetId]:{supported:false,required:[],reasonCodes:['SCENARIO_UNSUPPORTED_BY_SET']}}}}]){
  expect(()=>requestForPreset(selected,[],health)).toThrow();
 }
});
test('changing the workspace backend clears the recovery selections, including the nudge',async()=>{
 const {TwinWorkspace}=await import('../../src/ui/workspace');
 const w=Object.create(TwinWorkspace.prototype);
 Object.assign(w,{preset:{...preset,graspMode:'belief_estimated',graspProgramId:TWO_STAGE,worldExperimentId:CUP_NUDGE},rt:{paired:true},health:h,checkReadiness:async()=>{},rerender:()=>{}});
 w.change('twin-backend-set','mock-default');
 const r=requestForPreset(w.preset,[],h);
 expect(r).toMatchObject({backendSetId:'mock-default',mode:'mock'});
 expect(r).not.toHaveProperty('graspProgramId');expect(r.worldExperimentId).not.toBe(CUP_NUDGE);
 w.change('twin-grasp-program',TWO_STAGE);w.change('twin-world-experiment',CUP_NUDGE);
 expect(w.preset.graspProgramId).toBeUndefined();expect(w.preset.worldExperimentId).not.toBe(CUP_NUDGE);
});
