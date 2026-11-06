import {BrandLogo} from '../../../../components/BrandLogo';
import {guestMenu} from '../../../../server/modules/guest/api';
import {Menu} from '../../../../components/guest/Menu';
/** Public read-only menu (/menu/<venueId>?o=<organizationId>). Ordering needs the table QR; this page holds no session. */
export default async function GuestMenuPage({params,searchParams}:{params:Promise<{venueId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {venueId}=await params,organizationId=(await searchParams).o;
 const menu=typeof organizationId==='string'?await guestMenu({organizationId,venueId}).catch(()=>null):null;
 return <main className="cloud-guest" style={{padding:16,maxWidth:720,margin:'auto',fontSize:18}}><BrandLogo/><h1>Thực đơn / Menu</h1>
  {menu&&typeof organizationId==='string'?<Menu organizationId={organizationId} venueId={venueId} currency={menu.currency} items={menu.items}/>:<p>Không tìm thấy thực đơn / Menu not found</p>}
  <p>Muốn gọi món? Quét mã QR tại bàn hoặc gọi nhân viên. / To order, scan the QR code on your table or ask staff.</p></main>;
}
