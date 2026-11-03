import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {Promotions} from '../../../../components/backoffice/Promotions';
export default async function Page(){const actor=await resolveActor(new Request('http://localhost/admin/promotions',{headers:await headers()}));return actor?<Promotions venueId={actor.venueIds[0]}/>:null;}
