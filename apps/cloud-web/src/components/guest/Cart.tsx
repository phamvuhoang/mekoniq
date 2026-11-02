'use client';
import {money,touch,type GuestMenuItem} from './Menu';
/** The cart is a draft on the guest's phone; the price and acceptance are decided by the venue coordinator. */
export function Cart({lines,items,currency,busy,onChange,onSubmit}:{lines:Record<string,number>;items:GuestMenuItem[];currency:string;busy:boolean;onChange:(itemId:string,quantity:number)=>void;onSubmit:()=>void}){
 const chosen=Object.entries(lines).filter(([,n])=>n>0);
 const estimate=chosen.reduce((sum,[id,n])=>sum+BigInt(items.find(i=>i.id===id)?.unitMinor??'0')*BigInt(n),0n);
 return <section aria-label="Giỏ món / Cart"><h2>Món đã chọn / Your order</h2>
  {chosen.length===0?<p>Chưa chọn món / Nothing selected</p>:<ul style={{listStyle:'none',padding:0}}>{chosen.map(([id,n])=><li key={id} style={{display:'flex',gap:8,alignItems:'center'}}><span style={{flex:1}}>{items.find(i=>i.id===id)?.name??id} × {n}</span><button style={touch} onClick={()=>onChange(id,n-1)} aria-label="Bớt / Remove">−</button><button style={touch} onClick={()=>onChange(id,n+1)} aria-label="Thêm / Add">+</button></li>)}</ul>}
  <p>Tạm tính / Estimate: {money(String(estimate),currency)}</p>
  <button style={touch} disabled={busy||chosen.length===0} onClick={onSubmit}>Gửi món / Send order</button>
 </section>;
}
