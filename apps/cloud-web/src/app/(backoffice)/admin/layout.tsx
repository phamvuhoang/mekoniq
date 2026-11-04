import type {ReactNode} from 'react';
import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {resolveActor} from '../../../server/modules/identity/session';
export const dynamic='force-dynamic';
export default async function AdminLayout({children}:{children:ReactNode}){
 const requestHeaders=await headers();const actor=await resolveActor(new Request('http://localhost/admin',{headers:requestHeaders}));
 if(!actor)redirect('/login');
 if(!actor.permissions.includes('*')&&!actor.permissions.includes('configuration.read'))return <main><h1>Không có quyền / Access denied</h1></main>;
 const chain=actor.permissions.includes('*')||actor.permissions.includes('chain.read');
 return <><header><a href="/admin/settings">MEKONIQ · Quản trị</a> · <a href="/admin/catalog">Thực đơn / Menu</a> · <a href="/admin/operations">Vận hành / Operations</a> · <a href="/admin/promotions">Khuyến mãi / Promotions</a> · <a href="/admin/customers">Khách hàng / Customers</a> · <a href="/admin/reservations">Đặt bàn / Reservations</a>{chain&&<> · <a href="/admin/chain/configuration">Cấu hình chuỗi / Chain configuration</a> · <a href="/admin/chain/reports">Báo cáo chuỗi / Chain report</a></>}</header>{children}</>;
}
