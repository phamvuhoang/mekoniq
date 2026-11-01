import {rolePermissions} from '../../apps/cloud-web/src/server/modules/identity/rbac';
export const actors:Record<string,{role:string;deviceId:string;permissions:string[]}>=Object.fromEntries([
  ['cashier','cashier','device-a'],['chef','chef','device-kds'],['manager','manager','device-a'],['owner','owner','device-a'],['owner-a','owner','device-a'],['guest','guest','device-guest'],['device-a','cashier','device-a'],['device-b','cashier','device-b'],['printer-spool','spooler','device-a'],['cashier-2','cashier','device-a']
].map(([id,role,deviceId])=>[id,{role,deviceId,permissions:rolePermissions(role)}]));
