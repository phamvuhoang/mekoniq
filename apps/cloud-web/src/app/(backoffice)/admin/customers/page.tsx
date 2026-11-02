import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {Customers} from '../../../../components/backoffice/Customers';
export default async function Page(){const actor=await resolveActor(new Request('http://localhost/admin/customers',{headers:await headers()}));return actor?<Customers venueId={actor.venueIds[0]}/>:null;}
