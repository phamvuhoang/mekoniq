import type { ModuleRegistry } from '../modules';
import { changed, created, done, expectVersion, find, handle, text } from '../restaurant-context';
export function registerSuppliers(registry: ModuleRegistry): void {
  // Supplier.Upsert {supplierId,name,currency?,expectedVersion?}: purchases are priced in the supplier's currency.
  handle(registry, 'Supplier.Upsert', (c, s) => {
    const id = text(c.payload.supplierId), name = text(c.payload.name, 'NAME_REQUIRED'), currency = String(c.payload.currency ?? 'VND'), existing = find(s, 'supplier', id);
    if (!existing) return done([created('SupplierDefined', 'supplier', id, { name, currency })], { supplierId: id });
    expectVersion(c, existing);
    return done([changed('SupplierUpdated', existing, { name })], { supplierId: id });
  });
}
