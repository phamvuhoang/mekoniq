import type { JsonObject } from '../../../contracts/src/index';
/** A branch may change only these item fields; everything else (name, tax, modifiers, combo) stays the chain's. */
export const OVERRIDABLE_FIELDS = ['unitMinor', 'available', 'stationId'] as const;
export type BranchOverride = Record<string, { unitMinor?: string; available?: boolean; stationId?: string }>;
const MINOR = /^(0|[1-9][0-9]{0,29})$/;
export function validatedOverride(raw: unknown, itemIds: Set<string>): BranchOverride {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_OVERRIDE');
  const out: BranchOverride = {};
  for (const [itemId, patch] of Object.entries(raw)) {
    if (!itemIds.has(itemId)) throw new Error('OVERRIDE_UNKNOWN_ITEM');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) throw new Error('INVALID_OVERRIDE');
    for (const [field, value] of Object.entries(patch)) {
      if (!(OVERRIDABLE_FIELDS as readonly string[]).includes(field)) throw new Error('OVERRIDE_FIELD_NOT_ALLOWED');
      if ((field === 'unitMinor' && (typeof value !== 'string' || !MINOR.test(value))) || (field === 'available' && typeof value !== 'boolean') || (field === 'stationId' && (typeof value !== 'string' || !value))) throw new Error('INVALID_OVERRIDE');
    }
    out[itemId] = patch as BranchOverride[string];
  }
  return out;
}
/** Chain items with the branch's allowed fields laid over them. The input is not mutated; item order is the chain's. */
export function overlayItems(items: JsonObject[], override: BranchOverride): JsonObject[] {
  return items.map(item => (override[String(item.id)] ? { ...item, ...override[String(item.id)] } : item));
}
/** applied: venue acknowledged exactly the desired version; pending: not yet; superseded: the venue is already past it; failed: the venue or the cloud refused it. */
export function rolloutState(desired: number, effective: number, failedCode?: string): 'applied' | 'pending' | 'failed' | 'superseded' {
  if (failedCode) return 'failed';
  return desired === effective ? 'applied' : effective > desired ? 'superseded' : 'pending';
}
/** Item-level differences between two branches' effective menus (what a manager sees before publishing). */
export function compareItems(a: JsonObject[], b: JsonObject[]): { itemId: string; field: string; a: unknown; b: unknown }[] {
  const left = new Map(a.map(i => [String(i.id), i])), right = new Map(b.map(i => [String(i.id), i])), out: { itemId: string; field: string; a: unknown; b: unknown }[] = [];
  for (const id of [...new Set([...left.keys(), ...right.keys()])].sort()) {
    const x = left.get(id), y = right.get(id);
    if (!x || !y) { out.push({ itemId: id, field: '*', a: x ? 'present' : 'absent', b: y ? 'present' : 'absent' }); continue; }
    for (const field of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) if (JSON.stringify(x[field]) !== JSON.stringify(y[field])) out.push({ itemId: id, field, a: x[field], b: y[field] });
  }
  return out;
}
