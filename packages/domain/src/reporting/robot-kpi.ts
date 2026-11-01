import type { JsonObject, Snapshot } from '../../../contracts/src/index';
import { dayOf, ofKind } from './sales';
const COLUMNS = ['kind', 'id', 'businessDate', 'robotId', 'validation', 'status', 'firstIssuedAt', 'lastObservedAt', 'commands', 'commandsCompleted', 'commandsFailed', 'commandsUnknown'];
const FAILED = ['failed', 'rejected'], IN_FLIGHT = ['pending', 'accepted'];
type Tally = { missions: number; missionsCompleted: number; missionsCancelled: number; missionsNeedingAttention: number; missionsActive: number; commands: number; commandsCompleted: number; commandsFailed: number; commandsUnknown: number; commandsInFlight: number; avgCommandMs: string | null };
function tally(missions: Snapshot[], commands: Snapshot[]): Tally {
  const is = (xs: Snapshot[], st: string[]) => xs.filter(x => st.includes(String(x.state.status))).length;
  const timed = commands.filter(x => x.state.status === 'completed' && typeof x.state.observedAt === 'string').map(x => BigInt(Date.parse(String(x.state.observedAt)) - Date.parse(String(x.state.issuedAt)))).filter(ms => ms >= 0n);
  return { missions: missions.length, missionsCompleted: is(missions, ['completed']), missionsCancelled: is(missions, ['cancelled']), missionsNeedingAttention: is(missions, ['needs_attention']),
    missionsActive: missions.length - is(missions, ['completed', 'cancelled', 'needs_attention']), commands: commands.length, commandsCompleted: is(commands, ['completed']), commandsFailed: is(commands, FAILED),
    commandsUnknown: is(commands, ['unknown']), commandsInFlight: is(commands, IN_FLIGHT), avgCommandMs: timed.length ? String(timed.reduce((a, b) => a + b, 0n) / BigInt(timed.length)) : null };
}
/**
 * Robot KPI for a business date, from the durable robot-command journal (issuedAt) and the missions those commands belong to. A mission still queued
 * (no command yet) has no business time and is not counted. `validation` is the robot's own level: simulator figures stay labelled `simulated`.
 */
export function robotKpiReport(s: Snapshot[], date: string, tz: string): JsonObject {
  const commands = ofKind(s, 'robot-command').filter(x => dayOf(x.state.issuedAt, tz) === date), missionIds = new Set(commands.map(x => String(x.state.missionId)));
  const missions = ofKind(s, 'mission').filter(m => missionIds.has(m.ref.id)), robotIds = [...new Set(commands.map(x => String(x.state.robotId)))].sort();
  const robot = (id: string) => ofKind(s, 'robot').find(r => r.ref.id === id)?.state ?? {};
  const robots = robotIds.map(id => { const mine = commands.filter(x => x.state.robotId === id), ids = new Set(mine.map(x => String(x.state.missionId)));
    return { robotId: id, validation: String(robot(id).validation ?? 'unknown'), driver: String(robot(id).driver ?? 'unknown'), ...tally(missions.filter(m => ids.has(m.ref.id)), mine) }; });
  const rows = missions.map(m => { const mine = commands.filter(x => x.state.missionId === m.ref.id), t = tally([m], mine), robotId = String(mine[0]?.state.robotId ?? m.state.robotId ?? '');
    return { kind: 'mission', id: m.ref.id, businessDate: date, robotId, validation: String(robot(robotId).validation ?? 'unknown'), status: String(m.state.status), firstIssuedAt: mine.map(x => String(x.state.issuedAt)).sort()[0] ?? '',
      lastObservedAt: mine.map(x => String(x.state.observedAt ?? '')).sort().at(-1) ?? '', commands: String(t.commands), commandsCompleted: String(t.commandsCompleted), commandsFailed: String(t.commandsFailed), commandsUnknown: String(t.commandsUnknown) }; });
  return { columns: COLUMNS, totals: tally(missions, commands), robots, simulatedOnly: robots.length > 0 && robots.every(r => r.validation === 'simulated'), rows };
}
