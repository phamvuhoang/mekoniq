import {afterEach,expect,test,vi} from 'vitest';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {portableSimulationFromOptions,type MujocoProviderLike} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {defaultCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {amrAsset} from '../support/lab-v2';
const dirs:string[]=[];afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function setup(world=true){const directory=await mkdtemp('/tmp/b06-bootstrap-unit-');dirs.push(directory);const cap=(id:string)=>({...defaultCatalog.backends.find(b=>b.id===id)!,installed:true,compatible:true,reachable:true}),runtime={python:'verified-python',workerRoot:'verified-root',lockDigest:'a'.repeat(64),engineVersion:'3.17.0',schemaDir:'schemas'},armChecks=vi.fn(async()=>[{id:'runner',status:'ready' as const,reasonCodes:[],evidenceRef:'arm'}]),worldChecks=vi.fn(async()=>[{id:'runner',status:'ready' as const,reasonCodes:[],evidenceRef:'world'}]),factory=vi.fn(async()=>{throw Error('WORLD_FACTORY_SELECTED');});
 const mujoco={arm:{capability:cap('mujoco_arm'),runtime,readinessChecks:armChecks},mobile:{capability:cap('mujoco_3d'),plant:{port:{} as never,runtime}},...world?{world:{runtime,factory,readinessChecks:worldChecks}}:{}} as MujocoProviderLike;
 const sim=await portableSimulationFromOptions({enabled:false,python:'python3',workerRoot:'unused',lockPath:'unused',directory,mujoco});const project=JSON.parse(await readFile(resolve('robotics/simulation-mujoco/fixtures/coffee-delivery-cell-v1/project.json'),'utf8'));
 return {directory,sim,project,worldChecks,armChecks,factory};
}
test('normal portable cell composition selects world factory/readiness before the legacy arm path',async()=>{
 const h=await setup();const context={scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',project:h.project};await h.sim.readinessChecks!(context,new AbortController().signal);expect(h.worldChecks).toHaveBeenCalledOnce();expect(h.armChecks).not.toHaveBeenCalled();
 const input={...context,scenarioRevision:1,seed:7,mode:'simulation' as const,access:'simulated' as const,sourceCommit:'test'};
 await expect(h.sim.simulationFactory(input,{directory:join(h.directory,'run'),assets:[amrAsset],catalog:h.sim.catalog,enabledBackends:['mock_coffee',...h.sim.enabledBackends]})).rejects.toThrow('WORLD_FACTORY_SELECTED');expect(h.factory).toHaveBeenCalledOnce();
 const injected=vi.fn(async()=>{throw Error('TRUSTED_INJECTED_WORLD');});await expect(h.sim.simulationFactory(input,{directory:join(h.directory,'injected'),assets:[amrAsset],catalog:h.sim.catalog,enabledBackends:['mock_coffee',...h.sim.enabledBackends],worldPorts:injected})).rejects.toThrow('TRUSTED_INJECTED_WORLD');
 await h.sim.readinessChecks!({...context,scenarioId:'MJ-BV01',backendSetId:'engineering-mujoco-arm-v1'},new AbortController().signal);expect(h.armChecks).toHaveBeenCalledOnce();
});
test('missing shared-world provider blocks composition and never falls back to arm readiness',async()=>{
 const h=await setup(false);const checks=await h.sim.readinessChecks!({scenarioId:'MJ-CELL-BV01',backendSetId:'engineering-mujoco-cell-v1',project:h.project},new AbortController().signal);expect(checks.flatMap(c=>c.reasonCodes)).toContain('WORLD_COMPOSITION_UNAVAILABLE');expect(h.armChecks).not.toHaveBeenCalled();
 await expect(h.sim.simulationFactory({project:h.project,scenarioId:'MJ-CELL-BV01',scenarioRevision:1,backendSetId:'engineering-mujoco-cell-v1',mode:'simulation',access:'simulated',seed:7,sourceCommit:'test'},{directory:join(h.directory,'run')})).rejects.toThrow('WORLD_COMPOSITION_UNAVAILABLE');
});
