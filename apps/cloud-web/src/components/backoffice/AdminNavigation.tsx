'use client';
import {usePathname} from 'next/navigation';
export function AdminNavigation({chain}:{chain:boolean}){
 const path=usePathname();
 const links=[['settings','Quản trị / Settings'],['catalog','Thực đơn / Menu'],['operations','Vận hành / Operations'],['promotions','Khuyến mãi / Promotions'],['customers','Khách hàng / Customers'],['reservations','Đặt bàn / Reservations'],...(chain?[['chain/configuration','Cấu hình chuỗi / Chain configuration'],['chain/reports','Báo cáo chuỗi / Chain report']]:[])];
 return <nav aria-label="Quản trị / Administration">{links.map(([route,label])=><a key={route} href={'/admin/'+route} aria-current={path==='/admin/'+route?'page':undefined}>{label}</a>)}</nav>;
}
