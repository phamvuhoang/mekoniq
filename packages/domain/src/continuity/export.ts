import type {CommandEnvelope,Snapshot} from '../../../contracts/src/index';
import {hashPayload} from '../../../contracts/src/index';
import {ok} from './shared';
export function exportInventory(c:CommandEnvelope,s:Snapshot[]) {
  const inventory=s.map(x=>({kind:x.ref.kind,id:x.ref.id,version:x.version}));
  return ok([],{preserveOriginalIds:true,inventory,inventoryHash:hashPayload(inventory),encryptionRequired:true,generatedAt:c.recordedAt});
}
export function escapeCsvCell(value:string){return /^[=+\-@\t\r]/.test(value)?`'${value}`:value;}
