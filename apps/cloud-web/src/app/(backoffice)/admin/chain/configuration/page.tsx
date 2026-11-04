import {headers} from 'next/headers';
import {resolveActor} from '../../../../../server/modules/identity/session';
import {ChainConfiguration} from '../../../../../components/backoffice/ChainConfiguration';
export default async function Page(){const actor=await resolveActor(new Request('http://localhost/admin/chain/configuration',{headers:await headers()}));return actor?<ChainConfiguration venueIds={actor.venueIds}/>:null;}
