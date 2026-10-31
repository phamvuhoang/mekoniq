import type { JsonObject } from '../../../contracts/src/index';
import { fail, record } from '../restaurant-context';
import { localTimeAt } from '../shared/clock';
const TIME = /^(?:([01][0-9]|2[0-3]):([0-5][0-9])|24:00)$/;
const minutesOf = (value: unknown, code: string): number => typeof value === 'string' && TIME.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : fail(code);
/** Windows are venue-local; days are ISO weekdays (Mon=1..Sun=7) of the day the window STARTS. from>to wraps past midnight. */
export function validatedAvailability(value: unknown): JsonObject | undefined {
  if (value === undefined || value === null) return undefined;
  const windows = record((value as JsonObject)).windows;
  if (!Array.isArray(windows) || windows.length < 1 || windows.length > 14) return fail('INVALID_AVAILABILITY');
  return { windows: windows.map(raw => {
    const w = record(raw), days = w.days === undefined ? [1, 2, 3, 4, 5, 6, 7] : w.days;
    if (!Array.isArray(days) || !days.length || days.some(d => !Number.isInteger(d) || (d as number) < 1 || (d as number) > 7) || new Set(days).size !== days.length) return fail('INVALID_AVAILABILITY');
    const from = minutesOf(w.from, 'INVALID_AVAILABILITY'), to = minutesOf(w.to, 'INVALID_AVAILABILITY');
    if (from === to || from === 1440) return fail('INVALID_AVAILABILITY');
    return { days: [...days].sort(), from: w.from!, to: w.to! };
  }) };
}
export function availableAt(availability: unknown, at: string, timeZone: string): boolean {
  const windows = (availability as JsonObject | undefined)?.windows as JsonObject[] | undefined;
  if (!windows) return true;
  let local: { weekday: number; minutes: number };
  try { local = localTimeAt(at, timeZone); } catch { return fail('INVALID_TIMEZONE'); }
  const previous = local.weekday === 1 ? 7 : local.weekday - 1;
  return windows.some(w => {
    const days = w.days as number[], from = minutesOf(w.from, 'INVALID_AVAILABILITY'), to = minutesOf(w.to, 'INVALID_AVAILABILITY');
    if (from < to) return days.includes(local.weekday) && local.minutes >= from && local.minutes < to;
    return (days.includes(local.weekday) && local.minutes >= from) || (days.includes(previous) && local.minutes < to);
  });
}
