import {headers} from 'next/headers';
import {resolveActor} from '../../../../../server/modules/identity/session';
import {ChainReports} from '../../../../../components/backoffice/ChainReports';
export default async function Page(){const actor=await resolveActor(new Request('http://localhost/admin/chain/reports',{headers:await headers()}));return actor?<ChainReports/>:null;}
