import type { JsonObject } from '../../../contracts/src/index';
import { fail, record } from '../restaurant-context';
const bad = (): never => fail('INVALID_MODEL');
const pos = (v: unknown, max: number): number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max ? v as number : bad();
/**
 * Optional pricing models on a catalog item, normalised (anything else on the item is dropped by the caller): `weighed` {unitMass,unit} = unitMinor is the price of `unitMass`
 * of `unit`; `combo` {components:[{itemId,quantity}]} = unitMinor is the combo price, the components are existing plain items; `buffet` {durationMinutes,extendMinutes,extendItemId}
 * = the item is a time-boxed package whose extension is another existing item. One model per item.
 */
export function validatedModels(item: JsonObject, items: JsonObject[]): JsonObject {
  const models = ['weighed', 'combo', 'buffet'].filter(k => item[k] !== undefined);
  if (models.length > 1) return bad();
  const ref = (id: unknown) => items.find(x => x.id === id);
  if (item.weighed !== undefined) {
    const w = record(item.weighed);
    if (!/^[1-9][0-9]{0,9}$/.test(String(w.unitMass)) || !['g', 'ml'].includes(String(w.unit))) return bad();
    return { weighed: { unitMass: String(w.unitMass), unit: String(w.unit) } };
  }
  if (item.combo !== undefined) {
    const c = record(item.combo), parts = Array.isArray(c.components) && c.components.length >= 1 && c.components.length <= 20 ? c.components.map(x => record(x)) : bad();
    const components = parts.map(p => {
      const target = ref(p.itemId);
      if (!target || target.id === item.id || target.combo !== undefined || target.weighed !== undefined || target.buffet !== undefined || !/^[1-9][0-9]{0,3}$/.test(String(p.quantity))) return bad();
      return { itemId: String(p.itemId), quantity: String(p.quantity) };
    });
    return new Set(components.map(p => p.itemId)).size === components.length ? { combo: { components } } : bad();
  }
  if (item.buffet !== undefined) {
    const b = record(item.buffet), extra = ref(b.extendItemId);
    if (!extra || extra.id === item.id || extra.buffet !== undefined) return bad();
    return { buffet: { durationMinutes: pos(b.durationMinutes, 720), extendMinutes: pos(b.extendMinutes, 240), extendItemId: String(b.extendItemId) } };
  }
  return {};
}
