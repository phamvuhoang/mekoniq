import type { JsonObject } from '../../../contracts/src/index';
import { amount, fail, record, text } from '../restaurant-context';
export function validatedModifierGroups(value: unknown): JsonObject[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20) return fail('INVALID_MODIFIER_GROUP');
  const groups = value.map(raw => {
    const g = record(raw as JsonObject), kind = g.kind === 'size' ? 'size' : g.kind === undefined || g.kind === 'addon' ? 'addon' : fail('INVALID_MODIFIER_GROUP');
    const options = Array.isArray(g.options) && g.options.length >= 1 && g.options.length <= 50 ? g.options.map(o => {
      const x = record(o);
      return { id: text(x.id, 'INVALID_MODIFIER_GROUP'), name: text(x.name, 'INVALID_MODIFIER_GROUP'), priceMinor: amount(x.priceMinor), ...(x.available === false ? { available: false } : {}) };
    }) : fail('INVALID_MODIFIER_GROUP');
    const min = g.min ?? 0, max = g.max ?? options.length;
    if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) < 0 || (max as number) < Math.max(1, min as number) || (max as number) > options.length || new Set(options.map(o => o.id)).size !== options.length) return fail('INVALID_MODIFIER_GROUP');
    if (kind === 'size' && (min !== 1 || max !== 1)) return fail('INVALID_MODIFIER_GROUP');
    return { id: text(g.id, 'INVALID_MODIFIER_GROUP'), name: text(g.name, 'INVALID_MODIFIER_GROUP'), kind, min: min as number, max: max as number, options };
  });
  if (new Set(groups.map(g => g.id)).size !== groups.length || groups.filter(g => g.kind === 'size').length > 1) return fail('INVALID_MODIFIER_GROUP');
  return groups;
}
/** Applies a cart line's picks to an item's groups. A size option's price REPLACES the unit price; add-on prices are per unit. */
export function resolveModifiers(item: JsonObject, picks: unknown): { unitMinor: string; modifiers: JsonObject[] } {
  const groups = (item.modifierGroups ?? []) as JsonObject[];
  if (picks !== undefined && (!Array.isArray(picks) || picks.length > 50)) return fail('INVALID_MODIFIER');
  const chosen = ((picks ?? []) as JsonObject[]).map(p => {
    const pick = record(p), group = groups.find(g => g.id === text(pick.groupId)) ?? fail('MODIFIER_GROUP_NOT_FOUND');
    const option = (group.options as JsonObject[]).find(o => o.id === text(pick.optionId)) ?? fail('MODIFIER_NOT_FOUND');
    if (option.available === false) return fail('MODIFIER_SOLD_OUT');
    return { group, option };
  });
  if (new Set(chosen.map(c => `${c.group.id}\u0000${c.option.id}`)).size !== chosen.length) return fail('DUPLICATE_MODIFIER');
  for (const group of groups) {
    const count = chosen.filter(c => c.group === group).length;
    if (count < Number(group.min) || count > Number(group.max)) return fail('MODIFIER_SELECTION_INVALID');
  }
  const size = chosen.find(c => c.group.kind === 'size');
  return {
    unitMinor: size ? String(size.option.priceMinor) : String(item.unitMinor),
    modifiers: chosen.map(c => ({ groupId: String(c.group.id), optionId: String(c.option.id), name: String(c.option.name), priceMinor: String(c.option.priceMinor), kind: String(c.group.kind) })),
  };
}
