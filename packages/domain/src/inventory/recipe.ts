import type { ModuleRegistry } from '../modules';
import type { JsonObject } from '../../../contracts/src/index';
import { changed, created, done, expectVersion, fail, find, handle, record, records, text } from '../restaurant-context';
import { UNITS, parseDecimal } from './uom';
import { toBase } from './movement';
export function registerRecipes(registry: ModuleRegistry): void {
  // Ingredient.Upsert {ingredientId,name,baseUnit,conversions?:{unit:'baseUnitsPerUnit'},negativePolicy?:'allow'|'block',currency?,expectedVersion?}: the stock item is the
  // ingredient master and its running balance in one aggregate; the balance is a projection of the movement ledger and is never set from here.
  handle(registry, 'Ingredient.Upsert', (c, s) => {
    const id = text(c.payload.ingredientId), baseUnit = text(c.payload.baseUnit, 'UNKNOWN_UNIT'), name = text(c.payload.name, 'NAME_REQUIRED'), policy = c.payload.negativePolicy ?? 'allow';
    if (!UNITS[baseUnit]) return fail('UNKNOWN_UNIT');
    if (policy !== 'allow' && policy !== 'block') return fail('INVALID_POLICY');
    const conversions = c.payload.conversions === undefined ? {} : record(c.payload.conversions);
    for (const [unit, factor] of Object.entries(conversions)) if (UNITS[unit] || typeof factor !== 'string' || !/^[1-9][0-9]{0,29}$/.test(factor) || !/^[a-z][a-z0-9_-]{0,15}$/.test(unit)) return fail('INVALID_CONVERSION');
    const existing = find(s, 'stock-item', id);
    if (!existing) return done([created('IngredientDefined', 'stock-item', id, { name, baseUnit, conversions, negativePolicy: policy, currency: String(c.payload.currency ?? 'VND'), onHand: '0', valueMinor: '0', movementSeq: 0 })], { ingredientId: id });
    expectVersion(c, existing);
    if (baseUnit !== existing.state.baseUnit && Number(existing.state.movementSeq) > 0) return fail('BASE_UNIT_LOCKED');
    return done([changed('IngredientUpdated', existing, { name, baseUnit, conversions, negativePolicy: policy })], { ingredientId: id });
  });
  // Recipe.Publish {recipeVersion,itemId,lines:[{ingredientId,quantity,unit?}]}: a published version is immutable. The base quantity is frozen into the version at
  // publish time, so later changes to an ingredient's conversions or a newer recipe never change what an earlier version consumes.
  handle(registry, 'Recipe.Publish', (c, s) => {
    const version = text(c.payload.recipeVersion), itemId = text(c.payload.itemId), lines = records(c.payload.lines);
    const menu = find(s, 'catalog', 'current'), items = (menu?.state.items ?? []) as JsonObject[];
    if (!items.some(i => i.id === itemId)) return fail('ITEM_UNKNOWN');
    if (find(s, 'recipe', version)) return fail('RECIPE_VERSION_EXISTS');
    const seen = new Set<string>(), frozen = lines.map(line => {
      const ingredientId = text(line.ingredientId), item = find(s, 'stock-item', ingredientId);
      if (!item) return fail('INGREDIENT_UNKNOWN');
      if (seen.has(ingredientId)) return fail('DUPLICATE_INGREDIENT');
      seen.add(ingredientId);
      const quantity = text(line.quantity, 'INVALID_QUANTITY'), unit = line.unit === undefined ? String(item.state.baseUnit) : text(line.unit, 'UNKNOWN_UNIT');
      try { if (parseDecimal(quantity).n === 0n) return fail('INVALID_QUANTITY'); } catch { return fail('INVALID_QUANTITY'); }
      return { ingredientId, quantity, unit, baseQuantity: toBase(item.state, quantity, unit) };
    });
    const pointer = find(s, 'recipe-pointer', itemId);
    return done([created('RecipePublished', 'recipe', version, { itemId, lines: frozen as unknown as JsonObject[], publishedBy: c.actorRef, publishedAt: c.occurredAt }),
      pointer ? changed('RecipePointerMoved', pointer, { recipeVersion: version }) : created('RecipePointerMoved', 'recipe-pointer', itemId, { recipeVersion: version })], { recipeVersion: version });
  });
}
