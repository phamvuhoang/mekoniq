import {TableSession} from '../../../../components/guest/TableSession';
/** QR landing page. The token in the path is the guest's only credential; it is never a Supabase session. */
export default async function GuestTablePage({params}:{params:Promise<{token:string}>}){const {token}=await params;return <TableSession token={token}/>;}
