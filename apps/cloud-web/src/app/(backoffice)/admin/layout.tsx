import {AdminNavigation} from '../../../components/backoffice/AdminNavigation';
import {BrandLogo} from '../../../components/BrandLogo';
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
 return <><header className="cloud-header"><BrandLogo href="/admin/settings"/><AdminNavigation chain={chain}/></header><div className="cloud-admin">{children}</div></>;
}
