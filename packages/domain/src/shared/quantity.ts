import { canonicalMinor } from './money';
export interface Quantity { minor: string; scale: number; unit: string }
export function validateQuantity(value: Quantity): Quantity {
  canonicalMinor(value.minor);
  if (!Number.isInteger(value.scale) || value.scale < 0 || value.scale > 9 || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.unit))
    throw new Error('INVALID_QUANTITY');
  return value;
}
export function addQuantity(left: Quantity, right: Quantity): Quantity {
  validateQuantity(left); validateQuantity(right);
  if (left.unit !== right.unit || left.scale !== right.scale) throw new Error('QUANTITY_UNIT_MISMATCH');
  return { minor: canonicalMinor(String(BigInt(left.minor) + BigInt(right.minor))), scale: left.scale, unit: left.unit };
}
