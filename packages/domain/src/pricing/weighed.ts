import type { JsonObject } from '../../../contracts/src/index';
import { fail } from '../restaurant-context';
/** price is for `unitMass`; the result is price x mass / unitMass in whole minor units, rounded half up. Integers only: a scale reading is never turned into a float. */
export function priceByMass(price:string,mass:string,unitMass:string) {
  const m=BigInt(mass), u=BigInt(unitMass);
  if (m<0n || u<=0n) throw new Error("INVALID_MASS");
  return String((BigInt(price)*m + u/2n)/u);
}
/**
 * The measured line of a weighed item: exactly one portion (quantity 1) with {mass, source}. `scale` is accepted only from a scale profile the venue approved
 * (no profile = no pretend scale); `manual` is a keyed weight and records who approved it (the command also needs weighed.manual, see requiredPermissions).
 */
export function weighedLine(entry: JsonObject, raw: JsonObject, count: string, scaleIds: string[], actor: string | undefined): { priceMinor: string; measure: JsonObject } {
  if (count !== '1') return fail('WEIGHED_QUANTITY_INVALID');
  const m = raw.measure;
  if (m === undefined || m === null || typeof m !== 'object' || Array.isArray(m)) return fail('MEASURE_REQUIRED');
  const mass = m.mass, source = m.source, w = entry.weighed as JsonObject;
  if (typeof mass !== 'string' || !/^(0|[1-9][0-9]{0,11})$/.test(mass)) return fail('INVALID_MASS');
  if (source !== 'manual' && source !== 'scale') return fail('INVALID_MEASURE_SOURCE');
  if (source === 'scale' && !(typeof m.scaleId === 'string' && scaleIds.includes(m.scaleId))) return fail('SCALE_NOT_CONFIGURED');
  return { priceMinor: priceByMass(String(entry.unitMinor), mass, String(w.unitMass)), measure: { mass, unit: w.unit as string, unitMass: w.unitMass as string, source, ...(source === 'scale' ? { scaleId: m.scaleId as string } : actor ? { approvedBy: actor } : {}) } };
}
