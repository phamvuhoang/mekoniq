'use client';
export type GuestMenuItem={id:string;name:string;unitMinor:string;available:boolean;imageManifestId?:string;modifierGroups?:unknown[]};
export const touch={minHeight:48,minWidth:48,padding:'12px 20px',fontSize:18};
export const money=(minor:string,currency:string)=>{try{return new Intl.NumberFormat('vi-VN',{style:'currency',currency,maximumFractionDigits:0}).format(BigInt(minor));}catch{return `${minor} ${currency}`;}};
/** Menu list. Images come only through the guest image route, which serves ready menu_image manifests the current menu names. */
export function Menu({organizationId,venueId,currency,items,onAdd}:{organizationId:string;venueId:string;currency:string;items:GuestMenuItem[];onAdd?:(item:GuestMenuItem)=>void}){
 if(!items.length)return <p>Chưa có thực đơn / No menu yet</p>;
 return <ul style={{listStyle:'none',padding:0,display:'grid',gap:12}}>{items.map(item=>{
  // Items with options are ordered through staff in this first guest version; the venue would reject them without a choice.
  const orderable=item.available&&!item.modifierGroups?.length;
  return <li key={item.id} style={{display:'flex',gap:12,alignItems:'center',borderBottom:'1px solid var(--mq-border)',paddingBottom:12}}>
   {item.imageManifestId&&<img src={`/v1/guest/menu/${encodeURIComponent(organizationId)}/${encodeURIComponent(venueId)}/images/${encodeURIComponent(item.imageManifestId)}`} alt="" width={72} height={72} style={{objectFit:'cover',borderRadius:8}}/>}
   <span style={{flex:1}}><strong>{item.name}</strong><br/>{money(item.unitMinor,currency)}{!item.available&&' · Hết món / Sold out'}{item.available&&!orderable&&' · Gọi nhân viên để chọn / Ask staff for options'}</span>
   {onAdd&&<button style={touch} disabled={!orderable} onClick={()=>onAdd(item)} aria-label={`Thêm ${item.name} / Add ${item.name}`}>+</button>}
  </li>;})}</ul>;
}
