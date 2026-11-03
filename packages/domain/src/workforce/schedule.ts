import type { ModuleRegistry } from '../modules';
import type { JsonValue } from '../../../contracts/src/index';
import { created, done, fail, find, handle, text, all } from '../restaurant-context';
import { utcEpochMs } from '../shared/clock';
const DAY_MS = 24 * 3600_000;
const instant = (v: JsonValue | undefined): number => { try { return utcEpochMs(text(v, 'INVALID_RANGE')); } catch { return fail('INVALID_RANGE'); } };
export function registerSchedule(registry: ModuleRegistry): void {
  // Staff.Schedule {scheduleId,userId,startsAt,endsAt,stationId?}: UTC instants, so an overnight shift is one range (its business date is the venue-local day it STARTS).
  // The same person cannot hold two overlapping shifts; back-to-back is fine. Scheduling is intent only — it grants nothing (permissions stay in the identity workflow).
  handle(registry, 'Staff.Schedule', (c, s) => {
    const id = text(c.payload.scheduleId), userId = text(c.payload.userId), start = instant(c.payload.startsAt), end = instant(c.payload.endsAt);
    if (end <= start || end - start > DAY_MS) return fail('INVALID_RANGE');
    if (find(s, 'shift-schedule', id)) return fail('SCHEDULE_EXISTS');
    const stationId = c.payload.stationId === undefined ? null : text(c.payload.stationId);
    if (stationId && !find(s, 'station', stationId)) return fail('STATION_UNKNOWN');
    if (all(s, 'shift-schedule').some(o => o.state.userId === userId && start < Date.parse(String(o.state.endsAt)) && Date.parse(String(o.state.startsAt)) < end)) return fail('SCHEDULE_OVERLAP');
    return done([created('StaffScheduled', 'shift-schedule', id, { userId, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(), stationId, createdBy: c.actorRef })], { scheduleId: id });
  });
}
