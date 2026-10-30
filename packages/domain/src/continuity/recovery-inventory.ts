import type {Snapshot} from '../../../contracts/src/index';
import {grantBlocksReissue} from '../billing/settlement-grant';
export function recoveryInventory(s:Snapshot[]) {
  return {
    unknownRobots:s.filter(x=>x.ref.kind==='robot'&&['unknown','sending'].includes(String(x.state.goalState))).map(x=>x.ref.id),
    unknownGrants:s.filter(x=>x.ref.kind==='grant'&&grantBlocksReissue(String(x.state.status))).map(x=>x.ref.id),
    missingDevices:s.filter(x=>x.ref.kind==='device-checkpoint'&&x.state.status==='missing').map(x=>x.ref.id),
    loadedMissions:s.filter(x=>x.ref.kind==='mission'&&x.state.loaded===true).map(x=>x.ref.id)
    ,unknownReservations:s.filter(x=>x.ref.kind==='reservation'&&x.state.status!=='released').map(x=>x.ref.id)
  };
}
