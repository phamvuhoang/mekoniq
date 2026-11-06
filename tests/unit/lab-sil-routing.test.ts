import {expect,test,vi} from 'vitest';
const calls=vi.hoisted(()=>({native:vi.fn(async()=>{throw new Error('BV_FACTORY_REACHED');}),navigation:vi.fn(async()=>{throw new Error('FD_NAVIGATION_REACHED');})}));
vi.mock('../../packages/lab-runtime/src/v2/sil/native-providers',()=>({nativeProviderFactory:calls.native,doctorNativeArm:vi.fn()}));
vi.mock('../../packages/lab-runtime/src/v2/backends/gazebo-nav2',()=>({readCompiledWorld:async()=>({outputDirectory:'/compiled'}),startGazeboBackend:calls.navigation}));
vi.mock('../../packages/lab-runtime/src/v2/sil/campaign',()=>({runSilScenario:async(o:{backendFactory:(w:unknown,id:string)=>unknown})=>o.backendFactory({},'run')}));
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {runCli} from '../../packages/lab-runtime/src/v2/sil/cli';
test('actual CLI run dispatch routes FD01 and BV01 with the same native config independently',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cli-routing-'));try{const fixture=join(dir,'fixture.json'),config=join(dir,'native.json');await writeFile(fixture,JSON.stringify({project:{}}));await writeFile(config,JSON.stringify({sourceRoot:'/source',environmentProfile:'utm-ubuntu-arm64',arm:{socketPath:'/arm'}}));const base=['run','--fixture',fixture,'--bundle','/compiled','--out',dir,'--seed','23','--source-commit','test','--native-config',config];
 await expect(runCli([...base,'--scenario','FD01','--backend-set','simulation-default'])).rejects.toThrow('FD_NAVIGATION_REACHED');expect(calls.native).not.toHaveBeenCalled();expect(calls.navigation).toHaveBeenCalledOnce();
 await expect(runCli([...base,'--scenario','BV01','--backend-set','coffee-simulation'])).rejects.toThrow('BV_FACTORY_REACHED');expect(calls.native).toHaveBeenCalledOnce();
 await expect(runCli(base.slice(0,-2).concat(['--scenario','BV01','--backend-set','coffee-simulation']))).rejects.toThrow('NATIVE_SERVER_CONFIG_REQUIRED');
 }finally{await rm(dir,{recursive:true,force:true});}
});
