import {expect,test} from 'vitest';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
const input={project:{},scenarioId:'MJ-CELL-BV01',scenarioRevision:1,seed:7,mode:'simulation' as const,access:'simulated' as const,backendSetId:'engineering-mujoco-cell-v1',sourceCommit:'a'.repeat(40),graspMode:'belief_ground_truth' as const,graspProgramId:'cup-pick-two-stage-v1'};
test('direct run admission refuses a program outside its registered scope before providers or a journal are opened',async()=>{
 for(const extra of [{mode:'mock' as const},{scenarioId:'MJ-BV01'},{backendSetId:'engineering-mujoco-arm-v1'}])await expect(createScenarioRun({...input,...extra},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_MODE_SCOPE_INVALID');
 for(const graspMode of [undefined,'fixed_program' as const])await expect(createScenarioRun({...input,graspMode},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_PROGRAM_NOT_ALLOWED');
 await expect(createScenarioRun({...input,graspProgramId:'cup-pick-two-stage-v2'},{directory:'/unused/no-program-scope'})).rejects.toThrow('GRASP_PROGRAM_NOT_REGISTERED');
});
