import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test} from 'vitest';
import {nativeToolClosure} from '../../scripts/native-sim/tool-identity.mjs';

test('installing Python distribution metadata leaves tool identity stable while worker edits change it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tool-identity-'));
 try{
  const roots=['robotics/manipulation','robotics/simulation','robotics/simulation-3d/fixtures/serve-3d-v1','robotics/navigation','robotics/agent','packages/contracts/schemas','integrations/arm-controller/bridge','integrations/arm-controller/configs','integrations/arm-controller/models','integrations/arm-controller/programs','integrations/arm-controller/scripts','integrations/arm-controller/packaging','tests/fixtures/digital-twin'];
  for(const path of roots)await mkdir(join(root,path),{recursive:true});
  const agent=join(root,'robotics/agent/worker.py');
  await writeFile(agent,'VALUE = 1\n');
  const recorder=join(root,'integrations/arm-controller/scripts/smoke_driver.py'),lock=join(root,'integrations/arm-controller/packaging/dependencies.lock.json');
  await writeFile(recorder,'SAMPLER = 1\n');await writeFile(lock,'{"verified":false}\n');
  const nativeBefore=nativeToolClosure(root);
  expect(nativeBefore.files.some(f=>f.path==='integrations/arm-controller/scripts/smoke_driver.py')).toBe(true);
  expect(nativeBefore.files.some(f=>f.path==='integrations/arm-controller/packaging/dependencies.lock.json')).toBe(true);
  await writeFile(recorder,'SAMPLER = 2\n');expect(nativeToolClosure(root).digest).not.toBe(nativeBefore.digest);await writeFile(recorder,'SAMPLER = 1\n');
  await writeFile(lock,'{"verified":true}\n');expect(nativeToolClosure(root).digest).not.toBe(nativeBefore.digest);await writeFile(lock,'{"verified":false}\n');
  // An editable pip install leaves this metadata in a working checkout; a fresh git clone has none.
  for(const parent of ['robotics/agent','robotics/simulation']){
   for(const suffix of ['egg-info','dist-info']){
    const metadata=join(root,parent,`worker.1.0.${suffix}`);await mkdir(metadata);
    await writeFile(join(metadata,'PKG-INFO'),'Name: worker\nVersion: 1.0\n');
    await writeFile(join(metadata,'SOURCES.txt'),'worker.py\n');
   }
   // Older Python installations also use a single .egg-info file.
   await writeFile(join(root,parent,'legacy.egg-info'),'Name: legacy\n');
  }
  expect(nativeToolClosure(root)).toEqual(nativeBefore);
  await writeFile(agent,'VALUE = 2\n');
  expect(nativeToolClosure(root).digest).not.toBe(nativeBefore.digest);
 }finally{await rm(root,{recursive:true,force:true});}
});
