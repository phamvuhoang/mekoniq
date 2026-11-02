import {headers} from 'next/headers';
import {resolveActor} from '../../../../server/modules/identity/session';
import {OperationsReports} from '../../../../components/backoffice/OperationsReports';
export default async function Operations(){const actor=await resolveActor(new Request('http://localhost/admin/operations',{headers:await headers()}));return actor?<OperationsReports venueId={actor.venueIds[0]}/>:null;}
