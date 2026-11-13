import {expect,test} from 'vitest';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test.skipIf(!existsSync('.venv-mujoco/bin/python'))('the recorder pytest command writes JUnit without polluting the tool tree or relying on PYTEST_ADDOPTS',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'recorder-pytest-'));
 try{
  const plan=spawnSync(process.execPath,['scripts/record-sim-extension.mjs','--release','r2a','--out',join(dir,'record'),'--r11-record','unused','--mock-regression','unused','--plan'],{encoding:'utf8',timeout:60_000});
  expect(plan.status,plan.stderr).toBe(0);
  const command=plan.stdout.split('\n').find(l=>l.startsWith('ma-py\t'))!.split('\t')[2]!.split(' ');
  const python=command.shift()!,target=join(dir,'test_clean.py'),junit=join(dir,'result.xml');
  await writeFile(target,'def test_pass():\n    assert 2 + 2 == 4\n');
  const args=command.map(a=>a==='robotics/simulation-mujoco/tests'?target:a.startsWith('--junitxml=')?`--junitxml=${junit}`:a);
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTEST_ADDOPTS:''};
  const run=spawnSync(resolve(python),args,{cwd:dir,env,encoding:'utf8',timeout:30_000});
  expect(run.status,run.stdout+run.stderr).toBe(0);
  expect(await readFile(junit,'utf8')).toContain('failures="0"');
  expect(existsSync(join(dir,'.pytest_cache'))).toBe(false);
  expect(existsSync(join(dir,'__pycache__'))).toBe(false);
 }finally{await rm(dir,{recursive:true,force:true});}
},90_000);
