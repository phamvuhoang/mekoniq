import {supabaseAdmin} from '../../supabase/admin';
import {withTenant,type TenantScope} from '../identity/tenant-context';
import {venueChannel,type RealtimeHint} from '../../../../../../packages/sync/src/realtime-hints';
export async function publishHint(scope:TenantScope,hint:Omit<RealtimeHint,'scope'>,nowMs=Date.now()){
 const allowed=await withTenant(scope,async sql=>{
  const rows=await sql`INSERT INTO realtime_hint_budget(organization_id,venue_id,last_sent_at,watermark) VALUES(${scope.organizationId},${scope.venueId},${new Date(nowMs)},${hint.watermark})
  ON CONFLICT(organization_id,venue_id) DO UPDATE SET last_sent_at=EXCLUDED.last_sent_at,watermark=EXCLUDED.watermark
  WHERE realtime_hint_budget.last_sent_at<=${new Date(nowMs-5000)} RETURNING venue_id`;
  return rows.length===1;
 });
 if(!allowed)return {published:false,reason:'COALESCED'};
 const client=supabaseAdmin();const channel=client.channel(venueChannel(scope),{config:{private:true}});
 try{
  const result=await channel.httpSend('journal-hint',{scope,...hint});
  if(!result.success)throw new Error('REALTIME_UNAVAILABLE');
  return {published:true};
 }finally{await client.removeChannel(channel);}
}
