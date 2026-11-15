import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve as absolute} from 'node:path';
const nativeCompilerPython=process.env.ENGINEERING_PYTHON??(existsSync('.venv/bin/python')?absolute('.venv/bin/python'):'python3');
const nativeCompilerAvailable=spawnSync(nativeCompilerPython,['-c','import yaml,rfc8785'],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:5000,stdio:'ignore'}).status===0;
import {EngineeringClock,engineeringNativeAdmission} from '../../packages/lab-runtime/src/v2/sil/engineering-native';
import project from '../../robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json';
import {preflight} from '../../packages/lab-runtime/src/v2/sil/cli';

test('engineering FD01 uses its own project admission and never a legacy fixture',()=>{
 expect(preflight('FD01','engineering-rigid-v1')).toMatchObject({ok:true,fixture:null});
 expect(()=>engineeringNativeAdmission(project.runtimeProject,'FD01','engineering-rigid-v1','engineering-amd64')).not.toThrow();
 expect(()=>engineeringNativeAdmission({...project.runtimeProject,id:'legacy'},'FD01','engineering-rigid-v1','engineering-amd64')).toThrow('ENGINEERING_PROJECT_MISMATCH');
 expect(()=>engineeringNativeAdmission(project.runtimeProject,'BV01','engineering-contact-v1','engineering-amd64')).toThrow('ENGINEERING_SCENARIO_UNSUPPORTED');
 expect(()=>engineeringNativeAdmission(project.runtimeProject,'FD01','engineering-rigid-v1','utm-ubuntu-arm64')).toThrow('ENGINEERING_PROFILE_REQUIRED');
});

test('provider clock maps 20ms source ticks and latches reset or stale feedback',()=>{
 const clock=new EngineeringClock();clock.observe('1000000000',10n);clock.observe('1040000000',30n);
 expect(clock.tick).toBe(2);expect(clock.mapping).toEqual([{providerSimNs:'1000000000',sourceTick:0,receiveMonotonicNs:'10'},{providerSimNs:'1040000000',sourceTick:2,receiveMonotonicNs:'30'}]);
 expect(()=>clock.observe('1000000000',40n)).toThrow('CLOCK_RESET');
 expect(()=>clock.assertFresh(50n)).toThrow('CLOCK_RESET');
 const stale=new EngineeringClock();stale.observe('0',0n);stale.observe('0',400000000n);
 expect(()=>stale.assertFresh(500000001n)).toThrow('FEEDBACK_STALE');
});

test.skipIf(!nativeCompilerAvailable)('real canonical compiler feeds the engineering factory, whose unresolved host inventory blocks startup',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const {mkdtemp,rm,readFile,writeFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');
 const {engineeringNativeProviderFactory,readEngineeringCompiledWorld}=await import('../../packages/lab-runtime/src/v2/sil/engineering-native');
 const directory=await mkdtemp(join(tmpdir(),'l02-factory-')),python=nativeCompilerPython;
 try{
  await promisify(execFile)(python,['-m','compiler.engineering_native','--project',resolve('robotics/simulation-3d/fixtures/serve-3d-v1/serve-3d-project.json'),'--out',directory],{cwd:resolve('robotics/simulation'),env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:15000});
  const world=await readEngineeringCompiledWorld(directory);expect(world.robots).toEqual([{entityId:'amr-1',namespace:'amr_1'}]);
  const factory=await engineeringNativeProviderFactory({bundleDirectory:directory,environmentProfile:'engineering-amd64',python,simulationRoot:resolve('robotics/simulation')});
  const backend=await factory.open('portable-prerequisite-test');try{const cap=await backend.capability();expect(cap.available).toBe(false);expect(cap.reasons).toContain('INVENTORY_UNRESOLVED');}finally{await backend.close();}
  const file=join(directory,'robots/amr-1.urdf');await writeFile(file,(await readFile(file,'utf8')).replace('value="20"','value="21"')+'<!-- tampered -->');
  await expect(readEngineeringCompiledWorld(directory)).rejects.toThrow('BUNDLE_DIGEST_MISMATCH');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('engineering worker selection cannot fall through to a legacy worker without its profile',async()=>{
 const {startGazeboBackend}=await import('../../packages/lab-runtime/src/v2/backends/gazebo-nav2');
 const port={async request(){return {available:true,robots:[],evidence:'protocol_double'};},async close(){}};
 await expect(startGazeboBackend({} as never,'r',{engineering:true,port})).rejects.toThrow('ENGINEERING_PROFILE_REQUIRED');
});
