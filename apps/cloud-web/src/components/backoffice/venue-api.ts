/** Thin client for the generic back-office relay: reads come from the cloud projection (what the venue already applied), writes are intents the venue owner accepts or rejects. */
export type VenueRecord={id:string;version:number;state:Record<string,unknown>};
export async function readRecords(venueId:string,kind:string):Promise<VenueRecord[]>{
 const r=await fetch(`/v1/venues/${encodeURIComponent(venueId)}/records/${encodeURIComponent(kind)}`);
 if(!r.ok)throw new Error((await r.json().catch(()=>({}))).code??'READ_FAILED');
 return (await r.json()).records;
}
export async function sendCommand(venueId:string,type:string,payload:Record<string,unknown>,operationId=crypto.randomUUID()):Promise<{status:string;code?:string}>{
 const r=await fetch(`/v1/venues/${encodeURIComponent(venueId)}/commands`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type,payload,operationId})});
 const body=await r.json().catch(()=>({}));
 return r.ok?body:{status:'rejected',code:body.code??'REQUEST_FAILED'};
}
