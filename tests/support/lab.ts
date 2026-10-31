import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ModuleRegistry,stateEvent} from '../../packages/domain/src/modules';
import {openStore,type DurableStore} from '../../packages/sync/src/store';
import {processCommand} from '../../packages/sync/src/command-processor';
import type {CommandEnvelope,CommandResult,JsonObject,Scope,Handler} from '../../packages/contracts/src/index';
import {command as makeCommand,testSigner,testPublicJwk,testPrivateJwk} from './storage-cases';
import {actors} from './actors';
import {TestClock} from './clock';
import {FaultSwitch} from './faults';
export type ModuleInstaller=(registry:ModuleRegistry)=>void;
export class Lab {
  readonly scope:Scope={organizationId:`org-${randomUUID()}`,venueId:'venue-a'};
  readonly clock=new TestClock();
  readonly registry=new ModuleRegistry();
  readonly faults=new FaultSwitch();
  private stores=new Map<string,DurableStore>();
  private mode:'coordinated'|'wan'|'lan'='coordinated';
  private cloudApplied=new Set<string>();
  private observedEffects=new Map<string,number>();
  private authorizers:((actor:string,type:string,payload:JsonObject)=>boolean)[]=[];
  private genesis=new Map<string,{kind:string;id:string;version:number;state:JsonObject}>();
  constructor(readonly directory:string) {}
  async init(install?:ModuleInstaller) {
    this.registry.register('Journal.RecordNote',(c)=>({ok:true,events:[stateEvent('NoteRecorded','note',c.operationId,{text:c.payload.text??''})],value:{}}));
    install?.(this.registry);
    await this.getStore('coordinator');
    for(const deviceId of new Set(Object.values(actors).map(a=>a.deviceId)))await this.seed('device',deviceId,{deviceEpoch:'epoch-1',status:'active',publicJwk:JSON.parse(JSON.stringify(testPublicJwk))});
    return this;
  }
  addAuthorization(fn:(actor:string,type:string,payload:JsonObject)=>boolean){this.authorizers.push(fn);}
  async getStore(device:string) {
    let store=this.stores.get(device);
    if(!store) {
      store=await openStore({driver:'sqlite',url:join(this.directory,`${device}.db`),nowMs:()=>this.clock.nowMs,authority:{ownerDeviceId:'coordinator',deviceEpoch:'epoch-1',publicJwk:JSON.parse(JSON.stringify(testPublicJwk))},ackLevel:device==='coordinator'?'venue':'local',producer:{deviceId:device,deviceEpoch:'epoch-1'},signerPublicJwk:JSON.parse(JSON.stringify(testPublicJwk)),signer:testSigner,fault:point=>{if(this.faults.consume(point))throw new Error(point==='storage-full'?'STORAGE_FULL':'INJECTED_FAILURE');}});
      await store.provision(this.scope,1,1);this.stores.set(device,store);
    }
    return store;
  }
  async command(actor:string,type:string,payload:JsonObject,operationId:string=randomUUID()):Promise<CommandResult> {
    const identity=actors[actor];
    if(!identity) return {status:'rejected',code:'UNAUTHENTICATED',value:{},duplicate:false,ack:'none',operationId};
    const c=makeCommand(operationId,payload,{...this.scope,type,actorRef:actor,deviceId:identity.deviceId,deviceEpoch:'epoch-1',occurredAt:new Date(this.clock.nowMs).toISOString(),recordedAt:new Date(this.clock.nowMs).toISOString(),...(typeof payload.expectedVersion==='number'?{expectedVersion:payload.expectedVersion}:{})});
    // Read mode is an injected transport condition, never an alternate business implementation.
    const recipientLocal=['SettlementGrant.Use','SettlementGrant.Return'].includes(type);
    if(this.mode==='lan'&&!type.startsWith('Continuity.')&&!recipientLocal)return {status:'unknown',code:'COORDINATOR_UNAVAILABLE',value:{},duplicate:false,ack:'none',operationId};
    if(this.faults.consume('kill-after-local-commit'))return this.killAfterCommit(c);
    if(recipientLocal&&this.mode!=='lan')await this.cacheCoordinatorTo(identity.deviceId);
    const store=await this.getStore(this.mode==='lan'||recipientLocal?identity.deviceId:'coordinator');
    const can=async()=>this.authorizers.length?this.authorizers.some(fn=>fn(actor,type,payload)):type==='Journal.RecordNote';
    const decide:Handler=(command,snapshots)=>this.registry.decide(command,snapshots);
    const r=await processCommand(store,c,decide,can);
    if(this.faults.consume('drop-local-ack')&&r.status==='accepted')return {...r,status:'unknown',ack:'none'};
    return r;
  }
  private async killAfterCommit(c:CommandEnvelope):Promise<CommandResult> {
    const child=spawn(process.execPath,['--import','tsx','tests/support/child-store.mjs'],{cwd:process.cwd(),env:{...process.env,MEKONIQ_TEST_STORE:join(this.directory,'coordinator.db'),MEKONIQ_TEST_COMMAND:JSON.stringify(c),MEKONIQ_TEST_KEY:JSON.stringify(testPrivateJwk),MEKONIQ_TEST_FAULT:'kill-after-local-commit'},stdio:['ignore','ignore','pipe']});
    let errors='';child.stderr.on('data',v=>{errors+=v;});
    const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));
    if(code!==null&&code!==0) throw new Error(errors);
    return {status:'unknown',value:{},duplicate:false,ack:'none',operationId:c.operationId};
  }
  async seed(kind:string,id:string,overrides:JsonObject) {
    const version=typeof overrides.version==='number'?overrides.version:1;
    await (await this.getStore('coordinator')).seed(this.scope,kind,id,overrides,version);
    this.genesis.set(`${kind}:${id}`,{kind,id,version,state:overrides});
  }
  initialSnapshots(){return [...this.genesis.values()];}
  async state<T>(kind:string,id:string):Promise<T> {
    const s=await (await this.getStore('coordinator')).readSnapshot({...this.scope,kind,id});
    return {...s.state,version:s.version} as T;
  }
  async count(type:string) {
    const events=await Promise.all([...this.stores.values()].map(s=>s.events(this.scope,type)));
    return events.flat().length;
  }
  async effectCount(type:string){
    const effects=await Promise.all([...this.stores.values()].map(s=>s.effects(this.scope,type)));
    return effects.flat().reduce((sum,e)=>sum+Number(e.attempts??0),0);
  }
  recordEffect(type:string){this.observedEffects.set(type,(this.observedEffects.get(type)??0)+1);}
  async fault(name:string){this.faults.arm(name==='before-local-commit'?'before-local-commit':name);}
  async restart(device:'coordinator'|'cloud'|'executor') {const s=this.stores.get(device);if(s){await s.close();this.stores.delete(device);}if(device==='coordinator')await this.getStore(device);}
  async cacheCoordinatorTo(device:string) {
    const source=await this.getStore('coordinator'),target=await this.getStore(device);
    for(const snapshot of await source.snapshots(this.scope))if(snapshot.ref.kind!=='__scope__'){
      const existing=await target.readSnapshot(snapshot.ref);
      if(existing.version===0)await target.seed(this.scope,snapshot.ref.kind,snapshot.ref.id,snapshot.state,snapshot.version);
    }
  }
  async stateOn<T>(device:string,kind:string,id:string):Promise<T> {
    const s=await(await this.getStore(device)).readSnapshot({...this.scope,kind,id});return {...s.state,version:s.version} as T;
  }
  async partition(mode:'wan'|'lan'|'venue-b-wan'){
    if(mode==='lan'){await this.cacheCoordinatorTo('device-a');await this.cacheCoordinatorTo('device-b');}
    this.mode=mode==='lan'?'lan':'wan';
  }
  async heal(){this.mode='coordinated';}
  async sync(){
    if(this.mode!=='coordinated')throw new Error('TRANSPORT_UNAVAILABLE');
    // This transport must be supplied by W02; counting local records as cloud ACK is forbidden.
    if(!this.syncTransport)this.syncTransport=(await import('./lab-sync')).syncLab;
    await this.syncTransport(this);
  }
  syncTransport?: (lab:Lab)=>Promise<void>;
  markCloudApplied(id:string){this.cloudApplied.add(id);}
  devices(){return [...this.stores.entries()];}
  async cloudAppliedCount(){return this.cloudApplied.size;}
  async pendingCount(device='coordinator'){return (await (await this.getStore(device)).pending(this.scope)).length;}
  async advance(ms:number){this.clock.advance(ms);}
  async importApproved(rows:JsonObject[]) {
    const validated=await this.command('manager','Import.Validate',{rows,incidentRef:'test-maintenance'});
    if(validated.status!=='accepted')return validated;
    const batchId=validated.value.batchId;
    const preview=await this.command('manager','Import.Preview',{batchId});
    const approved=await this.command('manager','Import.Approve',{batchId,previewHash:preview.value.previewHash});
    if(approved.status!=='accepted')return approved;
    let applied=approved;
    for(let row=0;row<rows.length;row++) {
      applied=await this.command('manager','Import.Apply',{batchId},`apply-${batchId}-${row}`);
      if(applied.status!=='accepted')break;
    }
    return applied;
  }
  async unresolvedConflictCount(){return (await (await this.getStore('coordinator')).snapshots(this.scope)).filter(s=>s.ref.kind==='conflict'&&s.state.status==='open').length;}
  async close(){await Promise.all([...this.stores.values()].map(s=>s.close()));await rm(this.directory,{recursive:true,force:true});}
}
export async function createLab(install?:ModuleInstaller):Promise<Lab> {
  return new Lab(await mkdtemp(join(tmpdir(),'mekoniq-lab-'))).init(install);
}
