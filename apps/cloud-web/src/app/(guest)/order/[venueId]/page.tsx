import {BrandLogo} from '../../../../components/BrandLogo';
import {guestMenu} from '../../../../server/modules/guest/api';
import {OnlineCheckout} from '../../../../components/guest/OnlineCheckout';
/** Online ordering (/order/<venueId>?o=<organizationId>). SANDBOX ONLY until a certified channel profile exists: the page says so and the API refuses unless the sandbox flag is set. */
export default async function OnlineOrderPage({params,searchParams}:{params:Promise<{venueId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {venueId}=await params,organizationId=(await searchParams).o;
 const menu=typeof organizationId==='string'?await guestMenu({organizationId,venueId}).catch(()=>null):null;
 return <main className="cloud-guest" style={{padding:16,maxWidth:720,margin:'auto',fontSize:18}}><BrandLogo/><h1>Đặt món trực tuyến (thử nghiệm) / Online order (sandbox)</h1>
  {menu&&typeof organizationId==='string'?<OnlineCheckout organizationId={organizationId} venueId={venueId} currency={menu.currency} items={menu.items}/>:<p>Không tìm thấy thực đơn / Menu not found</p>}</main>;
}
