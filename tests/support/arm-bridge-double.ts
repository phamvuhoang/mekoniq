// Protocol double of the arm bridge service for TS tests: validates every message with the shared schemas (what the Python service refuses,
// this refuses), keeps one owner, stages/runs programs on a scripted state, answers duplicate ids from its table and can lose a reply after
// the effect. Evidence label `protocol_double`: it is never LinuxCNC. The real cross-runtime check is the shared message fixture.
import type {ArmBridgePort,ArmProfile} from '../../packages/lab-runtime/src/v2/arm/adapter';
import {validateArmCommand,validateArmObservation,type ArmCommand,type ArmObservation,type CellObservation} from '../../packages/lab-runtime/src/v2/contracts';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
type Reply=Extract<ArmObservation,{kind:'arm.reply.v1'}>;
type Status=Extract<ArmObservation,{kind:'arm.status.v1'}>;
export class ArmBridgeDouble implements ArmBridgePort {
 simulationSceneCapability=false;scenePin:{runId:string;worldRevision:string}|null=null;sceneSeq:bigint|null=null;
 owner:{token:string;actor:string;leaseId:string}|null=null;epoch=1;staged:string|null=null;interp:'idle'|'running'|'paused'='idle';homed=true;fault:string|null=null;
 unreachable=false;loseReply=false;sends=0;seq=0;bootId='ctl-double-1';jointsRad=[0,0,0,0,0.0017453292519943296,0];commandedRad=[0,0,0,0,0.0017453292519943296,0];
 readonly log:ArmCommand[]=[];readonly table=new Map<string,{payloadHash:string;reply:Reply}>();readonly outcomes=new Map<string,string>();readonly jobs=new Map<string,string>();
 private listeners=new Set<(m:ArmObservation)=>void>();private n=0;closed=0;
 constructor(readonly profile:ArmProfile,readonly nowMs:()=>number){}
 onMessage(l:(m:ArmObservation)=>void){this.listeners.add(l);return ()=>{this.listeners.delete(l);};}
 async close(){this.closed++;}
 private rid:string|null=null;
 private reply(commandId:string|null,status:Reply['status'],reasonCodes:string[],extra:Partial<Reply>={}):Reply{return {schemaVersion:1,kind:'arm.reply.v1',requestId:this.rid,commandId,status,lifecycle:'none',duplicate:false,reasonCodes,...extra} as Reply;}
 async send(m:ArmCommand):Promise<ArmObservation>{
  if(this.unreachable)throw new Error('BRIDGE_UNREACHABLE:ECONNREFUSED');
  this.rid=m.requestId??null;
  const v=validateArmCommand(m);if(!v.ok)return this.reply(null,'rejected',v.issues.map(i=>i.code));
  this.log.push(structuredClone(m));
  if(m.owner.actor==='local_operator')return this.reply(null,'rejected',['OWNER_KIND_NOT_ALLOWED_ON_CHANNEL:local_operator']);   // the double is the Lab channel
  if(m.machineId!==this.profile.machineId)return this.reply(null,'rejected',['MACHINE_MISMATCH']);
  if(m.expected.profileHash!==hashJson(this.profile as never))return this.reply(null,'rejected',['PROFILE_MISMATCH']);
  if(m.acquire){if(m.acquire.simulationScene&&!this.simulationSceneCapability){/* legacy bridge ignores no extension itself; negotiation is refused by the client */}if(this.owner)return this.reply(null,'rejected',[`OWNER_HELD:${this.owner.actor}`]);this.scenePin=m.acquire.simulationScene??null;this.sceneSeq=null;this.owner={token:`tok-${++this.n}`,actor:m.owner.actor,leaseId:`lease-${this.n}`};return this.reply(null,'accepted',[],{token:this.owner.token,leaseId:this.owner.leaseId,expiresAtMs:this.nowMs()+m.acquire.leaseMs,...this.simulationSceneCapability?{capabilities:['simulation_scene.v1']}:{} });}
  if(m.local||m.revoke)return this.reply(null,'rejected',[`CHANNEL_FORBIDDEN:${m.local?'local':'revoke'}`]);
  if(m.release||m.renew){if(!this.owner||m.owner.token!==this.owner.token)return this.reply(null,'rejected',['OWNER_TOKEN_INVALID']);if(m.release)this.owner=null;return this.reply(null,'accepted',[],m.renew?{expiresAtMs:this.nowMs()+this.profile.lease.ttlMs}:{});}
  if(m.reconcile&&!this.owner){const id=m.reconcile.commandId;return this.reply(id,'accepted',['OPERATOR_RECONCILE'],{lifecycle:'immediate',outcome:this.outcome(id)});}
  if(m.controllerEpoch!==this.epoch)return this.reply((m.command??m.reconcile)?.commandId??null,'rejected',['EPOCH_MISMATCH']);
  if(!this.owner||m.owner.token!==this.owner.token||m.leaseId!==this.owner.leaseId)return this.reply(m.command?.commandId??null,'rejected',['OWNER_TOKEN_INVALID']);
  if(m.reconcile){const id=m.reconcile.commandId;return this.reply(id,'accepted',['OPERATOR_RECONCILE'],{lifecycle:'immediate',outcome:this.outcome(id)});}
  if(m.simScene){if(!this.simulationSceneCapability||!this.scenePin)return this.reply(null,'rejected',['SIM_SCENE_UNSUPPORTED']);if(m.simScene.runId!==this.scenePin.runId||m.simScene.worldRevision!==this.scenePin.worldRevision)return this.reply(null,'rejected',['SIM_SCENE_PIN_MISMATCH']);const seq=BigInt(m.simScene.sceneSeq);if(this.sceneSeq!==null&&seq<=this.sceneSeq)return this.reply(null,'rejected',['SIM_SCENE_SEQUENCE_REPLAY']);this.sceneSeq=seq;return this.reply(null,'accepted',[]);}
  const c=m.command!;const prior=this.table.get(c.commandId);
  if(prior)return prior.payloadHash===c.payloadHash?{...prior.reply,duplicate:true,outcome:this.outcome(c.commandId)}:this.reply(c.commandId,'conflict',['COMMAND_ID_CONFLICT']);
  const answer=(r:Reply)=>{this.table.set(c.commandId,{payloadHash:c.payloadHash,reply:r});return r;};
  const program=this.profile.programs[c.programRef?.id??''];
  if(c.capability==='query_outcome')return this.reply(c.commandId,'accepted',[],{lifecycle:'immediate',outcome:this.outcome((c.payload as {targetCommandId:string}).targetCommandId)});
  if(this.fault)return answer(this.reply(c.commandId,'rejected',[`CONTROLLER_FAULT:${this.fault}`]));
  if(c.capability==='stage_program'){if(!c.programRef||!program)return answer(this.reply(c.commandId,'rejected',[`PROGRAM_NOT_ALLOWLISTED:${c.programRef?.id}`]));if(program.sha256!==c.programRef.hash)return answer(this.reply(c.commandId,'rejected',['PROGRAM_HASH_MISMATCH']));this.staged=c.programRef.id;return answer(this.reply(c.commandId,'accepted',[],{lifecycle:'accepted_not_completed'}));}
  if(c.capability==='start_job'){
   if(!c.programRef||this.staged!==c.programRef.id)return answer(this.reply(c.commandId,'rejected',['PROGRAM_NOT_STAGED']));
   if(!this.homed)return answer(this.reply(c.commandId,'rejected',['NOT_HOMED']));if(this.interp!=='idle')return answer(this.reply(c.commandId,'rejected',[`STATE_INVALID:${this.interp}`]));
   this.sends++;this.interp='running';this.outcomes.set(c.commandId,'running');this.jobs.set(c.commandId,(c.payload as {jobId:string}).jobId);
   if(this.loseReply){this.loseReply=false;this.table.set(c.commandId,{payloadHash:c.payloadHash,reply:this.reply(c.commandId,'outcome_unknown',['SEND_INTERRUPTED'],{lifecycle:'accepted_not_completed'})});throw new Error('BRIDGE_TIMEOUT');}
   return answer(this.reply(c.commandId,'accepted',[],{lifecycle:'accepted_not_completed'}));
  }
  const need:Record<string,string[]>={pause_job:['running'],resume_job:['paused'],cancel_job:['running','paused']};
  if(!need[c.capability]!.includes(this.interp))return answer(this.reply(c.commandId,'rejected',[`STATE_INVALID:${this.interp}`]));
  this.interp=c.capability==='pause_job'?'paused':c.capability==='resume_job'?'running':'idle';
  if(c.capability==='cancel_job')for(const [id,s] of this.outcomes)if(s==='running')this.outcomes.set(id,'failed');
  return answer(this.reply(c.commandId,'accepted',[],{lifecycle:'accepted_not_completed'}));
 }
 outcome(id:string){const found=this.log.find(m=>m.command?.commandId===id),command=found?.command;const identity={controllerIdentity:{bootId:this.bootId,epoch:this.epoch},commandIdentity:{commandId:id,deviceId:command?.deviceId??null,payloadHash:command?.payloadHash??null,controlEpoch:command?.controlEpoch??null,controllerEpoch:found?.controllerEpoch??null}};const s=this.outcomes.get(id);return s?{status:s as 'running'|'completed'|'failed',evidence:{source:'protocol_double',interp:this.interp,...identity}}:this.table.has(id)?{status:'completed' as const,evidence:{immediate:true,...identity}}:{status:'not_found' as const,evidence:{...identity}};}
 private stamp(){this.seq++;return {schemaVersion:1 as const,machineId:this.profile.machineId,controllerEpoch:this.epoch,bootId:this.bootId,seq:String(this.seq),observedAt:new Date(this.nowMs()).toISOString(),monotonicNs:String(process.hrtime.bigint())};}
 private emit(m:ArmObservation){const v=validateArmObservation(m);if(!v.ok)throw new Error('DOUBLE_EMITTED_INVALID:'+v.issues.map(i=>`${i.code}${i.path}`).join(','));for(const l of this.listeners)l(m);}
 /** One arm.status.v1 frame as the service would publish it (joints in SI, commanded and actual apart). */
 emitStatus(over:Partial<{actualRad:number[]|null;commandedRad:number[]|null;fault:string|null;homed:boolean;quality:'valid'|'stale'|'unknown';reconcileRequired:boolean;unknownCommands:string[]}>={}){
  const actual=over.actualRad===undefined?this.jointsRad:over.actualRad,commanded=over.commandedRad===undefined?this.commandedRad:over.commandedRad;
  const s:Status={...this.stamp(),kind:'arm.status.v1',owner:this.owner?{kind:this.owner.actor as never,actor:this.owner.actor,leaseId:this.owner.leaseId}:{kind:'none',actor:null,leaseId:null},reconcileRequired:over.reconcileRequired??false,unknownCommands:over.unknownCommands??[],
   task:{state:'on',mode:'auto',interp:this.interp,homed:over.homed??this.homed,fault:over.fault===undefined?this.fault:over.fault},
   joints:{names:['J1','J2','J3','J4','J5','J6'],commandedRad:commanded,actualRad:actual,velocityRadS:actual?[0,0,0,0,0,0]:null,followingErrorRad:actual&&commanded?actual.map((a,i)=>a-commanded[i]!):null,source:'controller_sim'},
   tcp:null,program:{id:this.staged,hash:this.staged?this.profile.programs[this.staged]!.sha256:null,state:this.interp==='running'?'running':this.interp==='paused'?'paused':this.staged?'staged':'none'},
   units:{source:{length:'inch',angle:'deg'},wire:'SI'},freshness:{staleMs:this.profile.telemetry.staleMs,quality:over.quality??'valid'},reasonCodes:actual?['TCP_ORIENTATION_NOT_PINNED']:['POSE_MISSING']};
  this.emit(s);return s;
 }
 /** The controller finished (or failed) a journaled start_job: the service's command_completed/command_failed event with the cell observation. */
 finish(commandId:string,result:'completed'|'failed',o:{controlEpoch:number;payloadHash:string;deviceId:string;evidence?:Record<string,unknown>;reasonCodes?:string[]}){
  this.interp='idle';this.outcomes.set(commandId,result);
  const st=this.stamp();
  const observation:CellObservation={schemaVersion:2,commandId,deviceId:o.deviceId,controlEpoch:o.controlEpoch,payloadHash:o.payloadHash,bootId:st.bootId,seq:st.seq,result,observedAt:st.observedAt,reasonCodes:o.reasonCodes??[]};
  this.emit({...st,kind:'arm.event.v1',event:result==='completed'?'command_completed':'command_failed',commandId,observation,reasonCodes:o.reasonCodes??[],detail:null,evidence:o.evidence??null} as ArmObservation);
 }
 /** A sampled virtual plant event. Tests supply modeled facts explicitly; completion never calls this. */
 emitGrip(command:import('../../packages/cell-adapters/src/contract').CellCommand,proof:import('../../packages/lab-runtime/src/v2/beverage/cup-ledger').TransferObservation){
  const st=this.stamp();const transferObservation={...proof,seq:st.seq,bootId:st.bootId};
  const observation:CellObservation={schemaVersion:2,commandId:command.commandId,deviceId:command.deviceId,controlEpoch:command.controlEpoch,payloadHash:command.payloadHash,bootId:st.bootId,seq:st.seq,result:'accepted',observedAt:st.observedAt,reasonCodes:[]};
  this.emit({...st,kind:'arm.event.v1',event:'virtual_grip',commandId:command.commandId,observation,reasonCodes:[],detail:null,evidence:{source:'protocol_double',transferObservation}} as ArmObservation);return transferObservation;
 }
 /** The bridge dropped our lease (expiry): the lease_expired event, then any running job becomes unknown. */
 expireLease(){this.owner=null;this.emitEvent('lease_expired',null,[]);for(const [id,s] of this.outcomes)if(s==='running'){this.outcomes.set(id,'unknown' as never);this.emitEvent('outcome_unknown',id,['LEASE_EXPIRED']);}}
 emitEvent(event:string,commandId:string|null,codes:string[]){this.emit({...this.stamp(),kind:'arm.event.v1',event,commandId,observation:null,reasonCodes:codes,detail:null,evidence:null} as ArmObservation);}
 reboot(bootId:string){this.bootId=bootId;this.epoch++;this.owner=null;this.staged=null;this.interp='idle';this.homed=false;for(const [id,s] of this.outcomes)if(s==='running')this.outcomes.set(id,'unknown' as never);this.emit({...this.stamp(),kind:'arm.event.v1',event:'controller_restart',commandId:null,observation:null,reasonCodes:[`EPOCH:${this.epoch}`],detail:null,evidence:null} as ArmObservation);}
}
