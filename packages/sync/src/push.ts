import type {JournalEntry,SyncAck} from '../../contracts/generated/wire';
export function acknowledgedEntries(pending:JournalEntry[],ack:SyncAck):string[]{
 return pending.filter(entry=>entry.organizationId===ack.organizationId&&entry.venueId===ack.venueId&&entry.deviceId===ack.deviceId&&entry.deviceEpoch===ack.deviceEpoch&&BigInt(entry.sequence)<=BigInt(ack.receivedCursor)&&ack.entries.some(r=>r.entryId===entry.entryId&&r.organizationId===entry.organizationId&&r.venueId===entry.venueId&&r.deviceId===entry.deviceId&&r.deviceEpoch===entry.deviceEpoch&&r.sequence===entry.sequence&&r.payloadHash===entry.payloadHash&&r.status!=='rejected')).map(e=>e.entryId);
}
export async function pushJournal(url:string,entries:JournalEntry[],headers:HeadersInit={}) {
 if(entries.length>100||new TextEncoder().encode(JSON.stringify(entries)).length>1048576)throw new Error('SYNC_BATCH_TOO_LARGE');
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({entries})});
 if(!response.ok)throw new Error(`SYNC_UNAVAILABLE:${response.status}`);
 return await response.json() as SyncAck;
}
