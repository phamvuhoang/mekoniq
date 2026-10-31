import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {VenueLayoutEditor} from '../../../../components/backoffice/VenueLayoutEditor';
import {FeatureSettings} from '../../../../components/backoffice/FeatureSettings';
export default async function Settings(){const actor=await resolveActor(new Request('http://localhost/admin/settings',{headers:await headers()}));return actor?<><VenueLayoutEditor venueId={actor.venueIds[0]}/><FeatureSettings venueId={actor.venueIds[0]}/></>:null;}
