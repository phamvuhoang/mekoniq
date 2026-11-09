// Provider-specific readiness and registration of the portable IR-SIM provider. The flag, interpreter and worker are operator options; test doubles only
// qualify the wiring and never make the provider installed. Cases that need the real worker are skipped where the IR-SIM venv is missing.
import {afterAll,afterEach,expect,test,vi} from 'vitest';
import {rm} from 'node:fs/promises';
import {join} from 'node:path';
import {defaultCatalog,type CapabilityCatalog} from '../../packages/lab-runtime/src/v2/capabilities';
import {collectReadiness} from '../../packages/lab-runtime/src/v2/readiness';
import {admitScenario,requiredBackends,resolveBackends,scenarioMatrix} from '../../packages/lab-runtime/src/v2/scenario-matrix';
import {scenarioHash,scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {createScenarioRun} from '../../packages/lab-runtime/src/v2/scenario-runner';
import {portableSimulationFromOptions} from '../../packages/lab-runtime/src/v2/navigation2d/readiness';
import {double,irPython,irsimAvailable,irsimBundle,irsimInput,removeBundles,temp,workerRoot} from '../support/irsim-mission';
import {executeFixture} from '../support/lab-v2';
afterAll(removeBundles);

const IR='engineering-irsim-2d-v1',ir=scenarioRegistry.get('IR-FD01')!,fd01=scenarioRegistry.get('FD01')!,lockPath=join(workerRoot,'requirements.lock');
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
const dir=async()=>{const d=await temp('irsim-ready-');dirs.push(d);return d;};
const irsimState=(c:CapabilityCatalog)=>c.backends.find(b=>b.id==='irsim_2d')!;

test('IR-FD01 revision 1 is FD01 under its own id; legacy scenarios keep their exact definitions and requirements',async()=>{
 expect(ir).toMatchObject({id:'IR-FD01',revision:1,basedOn:{id:'FD01',revision:1},robots:1,orders:fd01.orders,confirm:fd01.confirm,park:fd01.park,maxTicks:30000});
 // digest of every legacy scenario hash, frozen before IR-FD01 existed
 const legacy=[...scenarioRegistry].filter(([id])=>!id.startsWith('IR-'));
 expect(hashJson(Object.fromEntries(legacy.map(([id,d])=>[id,scenarioHash(d)])))).toBe('78d97a193bbaf054ac56c71600a90d251268e91460aff21c660b954d5da242b5');
 const row=scenarioMatrix.find(r=>r.id==='IR-FD01')!;
 expect(row).toMatchObject({runnerScenarios:['IR-FD01'],backendSupport:{mock:false,simulation:true,hardware:false},cell:false});
 expect(scenarioMatrix.find(r=>r.id==='FD01')!.runnerScenarios).toEqual(['FD01']);
 // C02 variants: their own ids and revisions on the IR set only, based on the FD business template they name; the legacy definitions stay as they were (hash above)
 for(const [id,base] of [['IR-FD03','FD03'],['IR-FD04','FD04'],['IR-FD04-blocked','FD04-blocked'],['IR-FD07','FD07']] as const){
  const d=scenarioRegistry.get(id)!,b=scenarioRegistry.get(base)!;
  expect(d,id).toMatchObject({revision:1,basedOn:{id:base,revision:1},robots:b.robots,orders:b.orders,confirm:b.confirm,park:b.park});
  expect(d.obstacles,id).toBeUndefined(); // actors live in the IR scenario fixture, never in the legacy obstacle schedule
  expect(scenarioMatrix.find(r=>r.id===id),id).toMatchObject({runnerScenarios:[id],backendSupport:{mock:false,simulation:true,hardware:false}});
 }
 expect([scenarioRegistry.get('IR-FD03')!.maxTicks,scenarioRegistry.get('IR-FD07')!.maxTicks]).toEqual([30000,12000]);
 expect(defaultCatalog.sets[IR]).toEqual({mode:'simulation',access:'simulated',backends:['irsim_2d'],providers:{amr:'irsim_2d'},scenarioIds:['IR-FD01','IR-FD03','IR-FD04','IR-FD04-blocked','IR-FD07'],execution:{host:'portable_python',clock:'source_fixed_step',manualStep:false,speedMultipliers:[1,4,16,64]}});
 // the default runtime does not advertise the portable provider as available
 expect(irsimState(defaultCatalog)).toMatchObject({installed:false,reachable:false,compatible:false});
 expect(irsimState(defaultCatalog).reason).toMatch(/^IRSIM_DISABLED/);
});

test('IR-* runs only on its set: legacy sets and the mode formula refuse it, the IR set refuses other scenarios, a missing provider role is SCENARIO_BACKEND_MISSING',async()=>{
 for(const [mode,set] of [['mock',undefined],['mock','mock-amr'],['mock','mock-default'],['simulation',undefined],['simulation','simulation-default'],['simulation','engineering-rigid-v1'],['simulation','engineering-contact-v1']] as const)
  expect(resolveBackends(ir,mode,set,defaultCatalog),`${mode}/${set}`).toMatchObject({ok:false,reasonCodes:['SCENARIO_UNSUPPORTED_BY_SET']});
 expect(resolveBackends(ir,'simulation',IR,defaultCatalog)).toEqual({ok:true,required:['irsim_2d'],reasonCodes:[]});
 for(const id of ['FD01','FD07','BV01'])expect(resolveBackends(scenarioRegistry.get(id)!,'simulation',IR,defaultCatalog),id).toMatchObject({ok:false,reasonCodes:['SCENARIO_UNSUPPORTED_BY_SET']});
 const noRole:CapabilityCatalog={...defaultCatalog,sets:{...defaultCatalog.sets,[IR]:{...defaultCatalog.sets[IR]!,providers:undefined}}};
 expect(resolveBackends(ir,'simulation',IR,noRole)).toMatchObject({ok:false,reasonCodes:['SCENARIO_BACKEND_MISSING']});
 expect(requiredBackends(fd01,'mock','mock-amr',defaultCatalog)).toEqual(['mock_amr']);
 expect(await admitScenario('IR-FD01',{mode:'mock',backendSetId:'mock-amr',available:['mock_amr']})).toMatchObject({status:'unsupported',reasons:['MODE_UNSUPPORTED:mock']});
 expect(await admitScenario('IR-FD01',{mode:'simulation',backendSetId:'simulation-default',available:['gazebo_nav2']})).toMatchObject({status:'unavailable',reasons:['SCENARIO_UNSUPPORTED_BY_SET']});
 expect(await admitScenario('IR-FD01',{mode:'simulation',backendSetId:IR,available:[]})).toMatchObject({status:'unavailable',reasons:['BACKEND_MISSING:irsim_2d']});
 // the mock runner never executes an IR scenario, whatever the project
 const d=await dir();
 await expect(createScenarioRun({project:{},scenarioId:'IR-FD01',scenarioRevision:1,seed:1,mode:'mock',access:'simulated',backendSetId:'mock-amr',sourceCommit:'t'},{directory:d,enabledBackends:['mock_amr']})).rejects.toThrow('SCENARIO_UNSUPPORTED_BY_SET');
});

test('flag off: the provider stays unavailable with a code, the factory refuses the IR set, native dispatch is untouched, and the mock FD01 still completes',async()=>{
 const native=vi.fn(async()=>{throw new Error('NATIVE_CALLED');});
 const p=await portableSimulationFromOptions({enabled:false,python:irPython,workerRoot,lockPath,directory:await dir(),nativeFactory:native});
 expect(p.enabledBackends).toEqual([]);expect(p.readinessChecks).toBeUndefined();expect(p.unavailable).toBe('IRSIM_DISABLED');
 expect(irsimState(p.catalog)).toMatchObject({installed:false,reachable:false});
 const input={project:{},scenarioId:'IR-FD01',scenarioRevision:1,seed:1,mode:'simulation' as const,access:'simulated' as const,sourceCommit:'t'};
 await expect(p.simulationFactory({...input,backendSetId:IR},{directory:await dir()})).rejects.toThrow('BACKEND_EXECUTION_DISABLED');
 await expect(p.simulationFactory({...input,backendSetId:'nope'},{directory:await dir()})).rejects.toThrow('BACKEND_SET_UNKNOWN');
 await expect(p.simulationFactory({...input,backendSetId:'engineering-rigid-v1'},{directory:await dir()})).rejects.toThrow('NATIVE_CALLED'); // native sets keep their own factory
 expect(native).toHaveBeenCalledTimes(1);
 const readiness=await collectReadiness({scenarioId:'IR-FD01',backendSetId:IR,project:{}},{catalog:p.catalog,enabledBackends:p.enabledBackends});
 expect(readiness.canStart).toBe(false);
 expect(readiness.checks.flatMap(c=>c.reasonCodes)).toEqual(expect.arrayContaining(['BACKEND_NOT_INSTALLED:irsim_2d','BACKEND_NOT_ENABLED:irsim_2d','IRSIM_RUNNER_UNAVAILABLE']));
 expect(readiness.checks.flatMap(c=>c.reasonCodes)).not.toContain('HOST_NOT_LINUX'); // the portable provider is not held to the native Linux gate
 const mock=await executeFixture('FD01',{seed:5});
 expect(mock.outcome.status).toBe('completed');expect(mock.manifest.backends.map(b=>b.id)).toEqual(['mock_amr']);
});

test('missing IR dependencies and test doubles never make the provider installed',async()=>{
 const missing=await portableSimulationFromOptions({enabled:true,python:'/nonexistent/python3.11',workerRoot,lockPath,directory:await dir()});
 expect(missing.unavailable).toBe('IRSIM_WORKER_UNAVAILABLE');expect(missing.enabledBackends).toEqual([]);expect(irsimState(missing.catalog).installed).toBe(false);
 const noLock=await portableSimulationFromOptions({enabled:true,python:irPython,workerRoot,lockPath:join(workerRoot,'no-such.lock'),directory:await dir()});
 expect(noLock.unavailable).toBe('IRSIM_WORKER_UNAVAILABLE');
 if(!irsimAvailable)return;
 for(const mode of ['garbage','hang']){
  const fake=await portableSimulationFromOptions({enabled:true,python:irPython,workerRoot,lockPath,directory:await dir(),entry:[double('scripted.py'),'--mode',mode]});
  expect(fake.unavailable,mode).toBe('IRSIM_WORKER_UNAVAILABLE');expect(irsimState(fake.catalog).reachable,mode).toBe(false);
 }
},30_000);

test.skipIf(!irsimAvailable)('real worker: IR-FD01 readiness checks bundle, scene, world, scenario and a create smoke; the native Linux gate still holds for Gazebo sets',async()=>{
 const b=await irsimBundle(),root=await dir();
 const p=await portableSimulationFromOptions({enabled:true,python:irPython,workerRoot,lockPath,directory:root,bundleFile:(d,f)=>b.service.bundleFile(d,f)});
 expect(p.unavailable).toBeUndefined();expect(p.enabledBackends).toEqual(['irsim_2d']);
 expect(p.describe).toMatchObject({packageVersion:'2.12.0'});expect(p.describe!.pythonVersion).toMatch(/^3\.11\./);
 expect(irsimState(p.catalog)).toMatchObject({installed:true,compatible:true,reachable:true});
 const options={catalog:p.catalog,enabledBackends:p.enabledBackends,portableChecks:p.readinessChecks};
 const input=irsimInput(b.locked),context={scenarioId:'IR-FD01',backendSetId:IR,project:input.project,engineering:b.locked.ref};
 const ready=await collectReadiness(context,options);
 expect(ready.checks.filter(c=>c.status!=='ready'),JSON.stringify(ready.checks)).toEqual([]);
 expect(ready.canStart).toBe(true);
 expect(ready.checks.find(c=>c.id==='runner')!.evidenceRef).toMatch(/^irsim-smoke:/);
 expect(ready.checks.find(c=>c.id==='profile')!.evidenceRef).toMatch(/^irsim:2\.12\.0\/python-3\.11/);
 // a world that is not the scene's, a missing engineering ref, the wrong scenario: blocked with the reason
 const moved=structuredClone(input.project) as {world:{width:number}};moved.world.width+=1;
 expect((await collectReadiness({...context,project:moved},options)).checks.flatMap(c=>c.reasonCodes)).toContain('SCENE_WORLD_MISMATCH');
 expect((await collectReadiness({scenarioId:'IR-FD01',backendSetId:IR,project:input.project},options)).checks.flatMap(c=>c.reasonCodes)).toContain('ENGINEERING_REF_REQUIRED');
 expect((await collectReadiness({...context,scenarioId:'FD01'},options)).checks.flatMap(c=>c.reasonCodes)).toContain('SCENARIO_UNSUPPORTED_BY_SET');
 // native sets keep the Linux requirement and never consult the portable checks
 const portableChecks=vi.fn(p.readinessChecks!);
 const native=await collectReadiness({scenarioId:'FD01',backendSetId:'engineering-rigid-v1',project:input.project},{...options,portableChecks});
 expect(portableChecks).not.toHaveBeenCalled();
 if(process.platform!=='linux')expect(native.checks.flatMap(c=>c.reasonCodes)).toContain('HOST_NOT_LINUX');
 expect(native.checks.flatMap(c=>c.reasonCodes)).toEqual(expect.arrayContaining(['MODEL_PROVIDER_UNAVAILABLE','NATIVE_RUNNER_UNAVAILABLE']));
 // the LinkForge flag is not consulted: IR runs are ready with it off
 expect(process.env.MEKONIQ_LAB_LINKFORGE).not.toBe('1');
},120_000);
