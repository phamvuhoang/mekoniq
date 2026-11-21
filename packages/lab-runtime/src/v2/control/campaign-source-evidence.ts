// Offline campaign verification opens only an isolated copy of the recorded Source journal.
import {createPublicKey,verify} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalBytes,validateJournal,type DomainEvent,type JsonObject,type JournalEntry} from '../../../../contracts/src/index';
import {hashJson} from '../hash';
import type {Attention,BusinessEvent,RunReport} from '../report';
import {readBoundedPhysicsFile} from '../simulation3d/physics-evidence';

export async function readCampaignJournal(runDir:string,runId:string){
 const scratch=await mkdtemp(join(tmpdir(),'campaign-source-'));
 try{
  for(const name of ['journal.db','journal.db-wal','journal.db-shm']){
   try{await writeFile(join(scratch,name),await readBoundedPhysicsFile(runDir,name,100*1024*1024),{mode:0o600,flag:'wx'});}
   catch(e){if(name==='journal.db'||(e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  const {kty,crv,x,y}=JSON.parse((await readBoundedPhysicsFile(runDir,'signing-key.json',8192)).toString());
  const key=createPublicKey({format:'jwk',key:{kty,crv,x,y}});
  const db=new DatabaseSync(join(scratch,'journal.db'),{readOnly:true});
  try{
   const rows=db.prepare('SELECT producer_sequence,entry_json FROM journal ORDER BY length(producer_sequence),producer_sequence LIMIT 100001').iterate();
   const entries:JournalEntry[]=[],events:BusinessEvent[]=[],states=new Map<string,JsonObject>();
   for(const row of rows){
    const entry=validateJournal(JSON.parse(String(row.entry_json))),{signature,...unsigned}=entry;
    if(entries.length>=100000||entry.sequence!==String(entries.length+1)||String(row.producer_sequence)!==entry.sequence||entry.organizationId!=='lab-'+runId||entry.venueId!=='simulation'||entry.deviceId!=='lab-coordinator'||entry.deviceEpoch!=='lab-epoch-1'||!verify('sha256',canonicalBytes(unsigned),{key,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')))throw Error('CAMPAIGN_JOURNAL_IDENTITY');
    entries.push(entry);
    for(const e of entry.payload.events as unknown as DomainEvent[])events.push({sequence:entry.sequence,at:entry.recordedAt,type:e.type,kind:String(e.data.kind),id:String(e.data.id),state:(e.data.state??{}) as JsonObject});
    for(const m of entry.payload.mutations as unknown as {ref:{kind:string;id:string};newState:JsonObject}[])states.set(m.ref.kind+'/'+m.ref.id,m.newState);
   }
   if(!entries.length)throw Error('CAMPAIGN_JOURNAL_EMPTY');
   return {entries,events,states};
  }finally{db.close();}
 }finally{await rm(scratch,{recursive:true,force:true});}
}
interface Job{jobId?:string;status:string;lineId?:string;missionId?:string}
interface CampaignCheckpoint{
 tick:number;attention:Attention[];started:boolean;cancelled:boolean;paused:boolean;confirmations:Record<string,{due:number|null}>;
 workload:Job[];coffee?:{workload:Job[]};roles:{robots:{id:string;parkingId:string}[]};manifest:{clock:{tickMs:number}};
}
// Both registered missions require completed work and a return to parking. The checkpoint supplies
// controller-local flags and attention. The signed Source mutations supply fulfillment and mission state.
export function verifyCampaignOutcome(cp:CampaignCheckpoint,source:Awaited<ReturnType<typeof readCampaignJournal>>,report:RunReport,prefix:'CELL'|'CIL'|'TRAY',beforeReopen=false){
 const {states,events}=source,fail=()=>{throw Error(prefix+'_OUTCOME_NOT_FROM_JOURNAL');};
 if(hashJson(report.businessEvents)!==hashJson(events))throw Error(prefix+'_SOURCE_REPORT');
 const get=(kind:string,id?:string)=>states.get(kind+'/'+id);
 const jobs=[...cp.workload,...cp.coffee?.workload??[]],lines=jobs.flatMap(j=>j.lineId?[j.lineId]:[]);
 if(new Set(lines).size!==lines.length)fail();
 let served=0n;
 for(const id of lines){const q=get('fulfillment',id)?.served;if(typeof q!=='string'||!/^\d+$/.test(q))return fail();served+=BigInt(q);}
 for(const [id,s] of states)if(id.startsWith('fulfillment/')&&BigInt(String(s.served??'0'))>0n&&!lines.includes(id.slice('fulfillment/'.length)))fail();
 const attention=beforeReopen?cp.attention.filter(a=>!(a.reason==='WORLD_RESTART_UNKNOWN'&&a.tick===cp.tick)):cp.attention;
 for(const [id,s] of states)if(id.startsWith('mission/')&&s.status==='needs_attention'&&!attention.some(a=>a.subjectId===id.slice(8)))fail();
 const done=jobs.length>0&&cp.workload.every(j=>j.status==='placed'&&get('mission',j.missionId)?.status==='completed')&&(cp.coffee?.workload??[]).every(j=>j.status==='done'&&get('coffee-job',j.jobId)?.status==='delivered'&&get('mission',j.missionId)?.status==='completed')&&cp.roles.robots.every(r=>{const s=get('robot',r.id);return s?.availability==='idle'&&!s.missionId&&s.position===r.parkingId;});
 const open=jobs.some(j=>j.missionId&&!['completed','cancelled','failed'].includes(String(get('mission',j.missionId)?.status)));
 const status=!cp.started?'ready':attention.length?'needs_attention':cp.cancelled?(open?'running':'cancelled'):done?'completed':cp.paused?'paused':Object.values(cp.confirmations).some(x=>x.due===null)?'awaiting_confirmation':'running';
 const outcome={status,served:String(served),tick:cp.tick,simTimeNs:String(BigInt(cp.tick)*BigInt(cp.manifest.clock.tickMs)*1000000n)};
 if(hashJson(outcome)!==hashJson(report.outcome)||hashJson(attention)!==hashJson(report.attention))fail();
 return outcome;
}
