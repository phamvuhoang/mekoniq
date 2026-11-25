import {existsSync} from 'node:fs';
import * as fs from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {afterEach,describe,expect,test,vi} from 'vitest';
import {act} from '../support/lab-v2';
import {openCell} from '../support/mujoco-cell';
import {traceSyncs} from '../support/world-sync';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
import {spawnMujocoWorker} from '../../packages/lab-runtime/src/v2/simulation3d/worker-client';
import type {WorldTickCommand} from '../../packages/lab-runtime/src/v2/simulation3d/world-ports';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return {...actual,open:vi.fn(actual.open),rename:vi.fn(actual.rename)};});
afterEach(async()=>{vi.restoreAllMocks();const actual=await vi.importActual<typeof fs>('node:fs/promises');vi.mocked(fs.open).mockImplementation(actual.open);vi.mocked(fs.rename).mockImplementation(actual.rename);});
describe.skipIf(!existsSync(resolve('.venv-mujoco/bin/python')))('direct measured-pulse factory persistence',()=>{
 test.each(['complete','create','file-sync','rename','directory-sync'])('%s through real MuJoCo without a sent scenario checkpoint',async outcome=>{
  const config={graspMode:'belief_estimated' as const,perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1',graspProgramId:'cup-pick-two-stage-v1'};
  let expected:WorldTickCommand|undefined,executionDigest:string|undefined,slot:number|undefined;
  const sends:number[]=[],syncOrder:string[]=[],proof:unknown[]=[];
  const h=await openCell(7,'direct-pulse',{cellDisturbance:{presetId:'world-cup-nudge-v2',cupId:'cup-1'}},config,async options=>{
   const w=await spawnMujocoWorker(options),dir=dirname(dirname(options.bundleRoot));return {...w,async request(req){
    const payload=req.payload as WorldTickCommand,segment=payload.worldPerturbations?.[0];
    if(!segment)return w.request(req);
    sends.push(segment.segmentIndex!);const stored=JSON.parse(await fs.readFile(join(dir,`world-pulse-intent-${segment.segmentIndex}.json`),'utf8'));
    expect(syncOrder).toEqual(['file','directory']);
    expect(stored).toEqual({schemaVersion:1,runId:req.runId,bootId:w.bootId,sceneDigest:options.sceneDigest,requestId:req.requestId,requestDigest:hashJson(payload),graspProgramExecutionDigest:executionDigest,command:expected});
    expect(payload).toEqual(expected);
    proof.push({segment:segment.segmentIndex,stored,syncOrder:[...syncOrder],at:'before_worker_request'});
    return w.request(req);
   }};
  });
  const retained=process.env.LAB_PULSE_SEND_EVIDENCE_DIR;
  try{
   let v=await h.run.start();while(v.tick<1535)v=await act(h.run,'step',{ticks:Math.min(50,1535-v.tick)});expect(v.tick).toBe(1535);
   const cp=JSON.parse(await fs.readFile(join(h.directory,'run.json'),'utf8'));executionDigest=cp.manifest.perception.program.executionDigest;
   expect(cp.world.pending).toBeUndefined();
   const b=h.bindings();
   const tmp=join(h.directory,'.world-pulse-intent-2.json.tmp'),final=join(h.directory,'world-pulse-intent-2.json'),actual=await vi.importActual<typeof fs>('node:fs/promises');
   const failAt=(phase:string)=>{if(slot===2&&outcome===phase){proof.push({segment:slot,at:'persistence_failure',phase,sends:[...sends]});throw Error('PULSE_PERSISTENCE_FAILED_'+phase);}};
   await traceSyncs({calls:[]},async file=>{
    if(slot===undefined)return;
    if(file===join(h.directory,`.world-pulse-intent-${slot}.json.tmp`))syncOrder.push('file');
    else if(file===h.directory&&syncOrder.at(-1)==='file')syncOrder.push('directory');
   },file=>{if(file===tmp)failAt('file-sync');if(file===h.directory&&syncOrder.at(-1)==='file')failAt('directory-sync');});
   const tracedOpen=vi.mocked(fs.open).getMockImplementation()!;
   vi.mocked(fs.open).mockImplementation(async(...args)=>{if(String(args[0])===tmp)failAt('create');return tracedOpen(...args);});
   vi.mocked(fs.rename).mockImplementation(async(from,to)=>{if(String(to)===final)failAt('rename');return actual.rename(from,to);});
   for(let index=0;index<5;index++){
    slot=index;syncOrder.length=0;const command=b.world.prepareTick(1536+index);expected=structuredClone(command);expect(command.worldPerturbations![0]!.segmentIndex).toBe(index);
    const stepping=b.world.step(command);
    // Neither the pending wire payload nor subsequent ACK validation can consult the caller's copy.
    command.gripperTargets[0]!.openingM=-999;command.worldInteractions=[{eventId:'spurious',kind:'birth',cupId:'cup-2',propId:'cup-2',targetTick:command.targetTick}];
    if(outcome!=='complete'&&index===2){
     await expect(stepping).rejects.toThrow('PULSE_PERSISTENCE_FAILED_'+outcome);expect(sends).toEqual([0,1]);
     await expect(b.world.step(expected)).rejects.toThrow('WORLD_COMMAND_INVALID');
     await b.evidence.fail({targetTick:1538,lastCommittedTick:1537,ackTick:null,reason:'PULSE_PERSISTENCE_FAILED_'+outcome});break;
    }
    const s=await stepping;slot=undefined;await b.evidence.append(s);await b.world.commit(s);
    expect(s.worldStep!.disturbances![0]).toMatchObject({...expected.worldPerturbations![0],requestDigest:hashJson(expected)});
    proof.push({at:'native_ack',receipt:s.worldStep!.disturbances![0]});
   }
   expect(sends).toEqual(outcome==='complete'?[0,1,2,3,4]:[0,1]);
   expect(JSON.parse(await fs.readFile(join(h.directory,'run.json'),'utf8')).world.pending).toBeUndefined();
  }finally{
   try{await h.run.close();}finally{try{if(retained){const dir=join(retained,outcome);await fs.mkdir(dir,{recursive:true});await fs.cp(h.directory,join(dir,'run'),{recursive:true});await fs.writeFile(join(dir,'proof.json'),JSON.stringify({accepted:false,outcome,sends,proof},null,2)+'\n');}}finally{await fs.rm(h.directory,{recursive:true,force:true});}}
  }
 },180_000);
});
