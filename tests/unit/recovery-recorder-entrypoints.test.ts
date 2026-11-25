import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,open,readFile,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,test,vi} from 'vitest';
// Keep the recorder, input copy and case disposition real. Supply controlled suite results and candidate identity.
vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),execFileSync:(_cmd:string,args:string[])=>args[0]==='status'?'':'a'.repeat(40)}));
vi.mock('../../scripts/repo-identity.mjs',()=>({sourceCommit:()=>'a'.repeat(40),sourceDirty:()=>'',labIdentity:()=>({commit:'a'.repeat(40),dirty:false})}));
vi.mock('../../scripts/lab-irsim.mjs',()=>({closureIdentity:()=>({portable:'portable'})}));
vi.mock('../../scripts/native-sim/r2b-process.mjs',()=>({runR2bCaseCommand:async(_node:string,_cmd:string[],{out}:{out:string})=>{
 await writeFile(join(out,'result.json'),JSON.stringify({numPassedTests:1,numFailedTests:0,numPendingTests:0,numTotalTests:1}));return {exitCode:0};
}}));
vi.mock('../../scripts/sim-extension-r4.mjs',async importOriginal=>{
 const original=await importOriginal<{tableR4():{suites:{id:string}[]}}>(),table=original.tableR4();
 return {...original,tableR4:()=>({...table,suites:table.suites.filter((s:{id:string})=>['rec-unit','rec-engine','rec-campaign-engine'].includes(s.id))})};
});
// @ts-expect-error plain ESM recorder
import {recordR4} from '../../scripts/record-sim-extension-r4.mjs';
test('recordR4 retains a supplied headerless recovery directory and records REC06 failed',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'r4-recorder-input-')),lab=join(temp,'lab'),input=join(temp,'fixtures'),recovery=join(temp,'recovery'),out=join(temp,'record');
 try{
  await mkdir(join(lab,'config'),{recursive:true});await mkdir(join(lab,'public/replays'),{recursive:true});
  await writeFile(join(lab,'public/replays/catalog.json'),'{}');await writeFile(join(lab,'config/source-runtime.lock.json'),JSON.stringify({sourceCommit:'a'.repeat(40),portableToolsDigest:'portable'}));
  await mkdir(input);await mkdir(recovery);await writeFile(join(recovery,'partial.json'),'{}');
  for(const name of ['campaign.json','qualification.json','container.json','manifest.json'])await writeFile(join(input,name),'{}');
  const args=['--out',out,'--lab',lab,'--recovery-campaign',recovery,...['r2b-record','cil-campaign','fault-campaign','tray-campaign','perception-study','bench-record','container-record','mock-regression'].flatMap(k=>['--'+k,input])];
  const log=vi.spyOn(console,'log').mockImplementation(()=>{});
  try{await recordR4(args);}finally{log.mockRestore();}
  expect(await readFile(join(out,'inputs/recovery/partial.json'),'utf8')).toBe('{}');
  const m=JSON.parse(await readFile(join(out,'qualification.json'),'utf8'));
  expect(m.accepted).toBe(false);expect(m.inputs.recoveryCampaign).toBeUndefined();expect(m.artifactDispositions.REC06.status).toBe('failed');expect(m.cases.REC06.status).toBe('failed');
  for(const id of ['REC01','REC02','REC03','REC04','REC05'])expect(m.cases[id].status).toBe('tested');
  await symlink(join(input,'campaign.json'),join(recovery,'campaign.json'));args[1]=join(temp,'unsafe');
  await expect(recordR4(args)).rejects.toThrow(/SYMLINK/);
 }finally{await rm(temp,{recursive:true,force:true});}
});
test.each(['linked','oversized'])('verify rejects the %s dispatch header before parsing or selecting a campaign',async kind=>{
 const temp=await mkdtemp(join(tmpdir(),'mujoco-dispatch-')),header=join(temp,'campaign.json');
 try{
  if(kind==='linked'){await writeFile(join(temp,'fixture'),'invalid json');await symlink('fixture',header);}
  else {const f=await open(header,'wx');try{await f.truncate(64*1024*1024+1);}finally{await f.close();}}
  const run=spawnSync(process.execPath,['scripts/lab-mujoco.mjs','verify','--input',temp],{encoding:'utf8',timeout:30000});
  expect(run.status).toBe(1);expect(run.stderr).toMatch(kind==='linked'?/CELL_ARTIFACT_PATH/:/CELL_ARTIFACT_LIMIT/);expect(run.stdout).toBe('');
 }finally{await rm(temp,{recursive:true,force:true});}
},45_000);
