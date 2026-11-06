import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,expect,test} from 'vitest';
import {hashPayload} from '../../packages/contracts/src/canonical';
import type {CellCommand,CellReport} from '../../packages/cell-adapters/src/contract';
import {LinuxcncArmAdapter,loadArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {ArmBridgeDouble} from '../support/arm-bridge-double';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
const profile=()=>loadArmProfile('integrations/arm-controller/configs/sim/puma560/profile.json');
function rig(cut?:(phase:string)=>void){
 const p=profile(),dir=mkdtempSync(join(tmpdir(),'arm-stage-'));dirs.push(dir);
 const nowMs=()=>Date.parse('2026-11-06T00:00:00Z'),bridge=new ArmBridgeDouble(p,nowMs),reports:CellReport[]=[];
 const options={port:bridge,profile:p,runId:'3f1c2b7e-9a4d-4c6e-8b2a-1d5e6f7a8b9c',cellId:'coffee-1',deviceId:'arm-1',nowMs,journalPath:join(dir,'arm.sqlite'),afterJournal:cut};
 const adapter=new LinuxcncArmAdapter(options);adapter.observe(r=>reports.push(r));
 const payload={jobId:'coffee-job-1'},command={commandId:'logical-pick',runId:options.runId,deviceId:'arm-1',controlEpoch:1,expiresAt:new Date(nowMs()+30000).toISOString(),recipeRevision:null,programRef:{id:'cup-pick',hash:p.programs['cup-pick']!.sha256},capability:'start_job',payloadHash:hashPayload(payload),payload} as CellCommand;
 return {adapter,bridge,command,reports,reopen:()=>new LinuxcncArmAdapter(options)};
}
test('one logical start durably stages its program first; stage acceptance never completes the logical command',async()=>{
 const r=rig();try{await r.adapter.open();expect(await r.adapter.execute(r.command)).toEqual({accepted:true,unknown:false});
  const commands=r.bridge.log.flatMap(m=>m.command?[m.command]:[]);expect(commands.map(c=>c.capability)).toEqual(['stage_program','start_job']);
  expect(commands[0]!.commandId).not.toBe(r.command.commandId);expect(commands[1]!.commandId).toBe(r.command.commandId);
  expect(r.reports.filter(x=>x.observation).map(x=>[x.observation!.commandId,x.observation!.result])).toEqual([[r.command.commandId,'accepted']]);
  await r.adapter.execute(r.command);expect(r.bridge.sends).toBe(1);
 }finally{await r.adapter.close();}
});
test.each(['stage_intent','stage_accepted','start_intent','start_accepted'])('restart after %s queries durable identity without replaying motion',async(phase)=>{
 let cut=true;const r=rig(p=>{if(cut&&p===phase)throw new Error('CUT');});
 await r.adapter.open();try{await r.adapter.execute(r.command);}catch(e){expect((e as Error).message).toBe('CUT');}
 const starts=r.bridge.sends;await r.adapter.close();cut=false;const reopened=r.reopen();
 try{await reopened.open();const before=r.bridge.log.length;await reopened.execute(r.command);
  expect(r.bridge.sends).toBe(starts);expect(r.bridge.log.slice(before).every(m=>!m.command||m.command.capability==='query_outcome')).toBe(true);
 }finally{await reopened.close();}
});
test('a stage timeout stays unknown and only queries on retry, even if the bridge accepted the lost stage ACK',async()=>{
 const r=rig(),send=r.bridge.send.bind(r.bridge);let lost=true;
 r.bridge.send=async m=>{const reply=await send(m);if(m.command?.capability==='stage_program'&&lost){lost=false;throw new Error('LOST_STAGE_ACK');}return reply;};
 try{await r.adapter.open();expect(await r.adapter.execute(r.command)).toMatchObject({unknown:true});expect(r.bridge.sends).toBe(0);
  await r.adapter.execute(r.command);expect(r.bridge.sends).toBe(0);expect(r.bridge.log.filter(m=>m.command?.capability==='stage_program')).toHaveLength(1);
 }finally{await r.adapter.close();}
});
