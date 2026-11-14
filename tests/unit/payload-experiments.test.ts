import {expect,test} from 'vitest';
import {PAYLOAD_EXPERIMENTS,payloadExperiment} from '../../packages/lab-runtime/src/v2/simulation3d/payload-experiments';
test('server selector objects are immutable and speed experiments change no load or physics input',()=>{
 for(const id of ['payload-slow-v1','payload-fast-v1']){const e=payloadExperiment(id);expect(e.load).toBe('cup-center');expect(e.physics).toBe('drive-contact-profile');expect(Object.isFrozen(e)).toBe(true);}
 expect(Object.isFrozen(PAYLOAD_EXPERIMENTS)).toBe(true);expect(()=>payloadExperiment('__proto__')).toThrow('UNREGISTERED');
});

test('the launch-only payload perturbation is refused by other worker providers before process spawn',async()=>{
 const {spawnIRSimWorker}=await import('../../packages/lab-runtime/src/v2/navigation2d/worker-client');
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const directory=await mkdtemp(join(tmpdir(),'perturbation-refuse-'));
 try{const result=await spawnIRSimWorker({python:'/no-such-interpreter',workerRoot:directory,bundleRoot:directory,runDirectory:directory,runId:'refusal',lockDigest:'a'.repeat(64),schemaDir:directory,payloadPerturbationId:'payload-cup-forward-impulse-v1'}).then(async w=>{await w.close('test');return 'accepted';},e=>e.message);expect(result).toBe('PERTURBATION_PROVIDER_UNSUPPORTED');}finally{await rm(directory,{recursive:true,force:true});}
});

test('the registered impulse changes source run input identity while baseline mobile identity stays absent',async()=>{
 const {mujocoMobilePlant}=await import('../../packages/lab-runtime/src/v2/simulation3d/mujoco-mobile');
 const runtime={python:'unused',workerRoot:'unused',schemaDir:'unused',lockDigest:'a'.repeat(64),engineVersion:'3.17.0'};
 const baseline=mujocoMobilePlant(runtime),stress=mujocoMobilePlant(runtime,'payload-cup-forward-impulse-v1');
 expect(baseline.identity.simulationPerturbation).toBeUndefined();expect(stress.identity.simulationPerturbation).toMatchObject({id:'payload-cup-forward-impulse-v1',revision:1,parameters:{targetTick:501,forceN:[30,0,0],frameId:'support',durationS:.02}});
});
