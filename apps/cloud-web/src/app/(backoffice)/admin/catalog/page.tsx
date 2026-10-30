import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {MenuEditor} from '../../../../components/backoffice/MenuEditor';
export default async function CatalogPage(){const actor=await resolveActor(new Request('http://localhost/admin/catalog',{headers:await headers()}));return actor?<MenuEditor venueId={actor.venueIds[0]}/>:null;}
