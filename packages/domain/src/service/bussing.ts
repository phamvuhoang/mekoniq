import type { ModuleRegistry } from '../modules';
import { fail, find, handle, text } from '../restaurant-context';
import { createMission } from '../fleet/mission';
/**
 * Mission.Bus {tableId,unloadAt?='wash',robotId?,missionId?}: collect dishes at a known table and unload them at a known station.
 * Once collected the mission is loaded; Mission.Cancel then keeps the unload stop instead of abandoning the cargo (fleet/mission.ts).
 */
export function registerBussing(registry: ModuleRegistry): void {
  handle(registry, 'Mission.Bus', (c, s) => {
    const tableId = text(c.payload.tableId, 'UNKNOWN_DESTINATION'), unloadAt = c.payload.unloadAt === undefined ? 'wash' : text(c.payload.unloadAt, 'UNKNOWN_DESTINATION');
    if (!find(s, 'table', tableId) || !find(s, 'station', unloadAt)) return fail('UNKNOWN_DESTINATION');
    return createMission({ ...c, payload: { kind: 'bus', stops: [{ action: 'collect', targetId: tableId }, { action: 'unload', targetId: unloadAt }], ...(c.payload.robotId !== undefined ? { robotId: c.payload.robotId } : {}), ...(c.payload.missionId !== undefined ? { missionId: c.payload.missionId } : {}) } }, s);
  });
}
