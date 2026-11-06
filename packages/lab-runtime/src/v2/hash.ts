import {hashPayload,type JsonValue} from '../../../contracts/src/index';
/** SHA-256 over RFC 8785 canonical JSON; lab/src/twin/hash.ts is the browser twin of this function. */
export const hashJson=(value:unknown):string=>hashPayload(JSON.parse(JSON.stringify(value)) as JsonValue);
