import {hashPayload} from '../../../contracts/src/index';
export function sourceKey(r:{venueId:string;sourceType:string;sourceSeries:string;sourceNumber:string}) {return JSON.stringify([r.venueId,r.sourceType,r.sourceSeries,r.sourceNumber]);}
export function sourceId(r:{venueId:string;sourceType:string;sourceSeries:string;sourceNumber:string}) {return hashPayload(sourceKey(r));}
