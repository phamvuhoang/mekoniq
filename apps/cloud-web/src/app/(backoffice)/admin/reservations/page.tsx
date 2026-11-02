import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {Reservations} from '../../../../components/backoffice/Reservations';
export default async function Page(){const actor=await resolveActor(new Request('http://localhost/admin/reservations',{headers:await headers()}));return actor?<Reservations venueId={actor.venueIds[0]}/>:null;}
