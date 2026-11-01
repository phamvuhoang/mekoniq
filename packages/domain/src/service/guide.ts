import type { ModuleRegistry } from '../modules';
import { fail, find, handle, text } from '../restaurant-context';
import { createMission } from '../fleet/mission';
/**
 * Mission.Guide {destinationId,robotId?,missionId?}: lead guests to a table the venue knows. An unknown destination fails before any robot
 * is selected or commanded; the robot must have the guide capability and a binding for the destination on its current map (selectRobot).
 */
export function registerGuide(registry: ModuleRegistry): void {
  handle(registry, 'Mission.Guide', (c, s) => {
    const destination = text(c.payload.destinationId, 'UNKNOWN_DESTINATION');
    if (!find(s, 'table', destination)) return fail('UNKNOWN_DESTINATION');
    return createMission({ ...c, payload: { kind: 'guide', stops: [{ action: 'guide', targetId: destination }], ...(c.payload.robotId !== undefined ? { robotId: c.payload.robotId } : {}), ...(c.payload.missionId !== undefined ? { missionId: c.payload.missionId } : {}) } }, s);
  });
}
