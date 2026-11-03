/** Units of measure and exact conversion to an ingredient's base unit. Quantities are decimal strings; stock is held in whole base units (g, ml, piece or a custom unit). */
export type Dimension = 'mass' | 'volume' | 'count';
export const UNITS: Record<string, { dimension: Dimension; factor: bigint }> = { g: { dimension: 'mass', factor: 1n }, kg: { dimension: 'mass', factor: 1000n }, ml: { dimension: 'volume', factor: 1n }, l: { dimension: 'volume', factor: 1000n }, piece: { dimension: 'count', factor: 1n } };
export type Decimal = { n: bigint; scale: number };
export type Convertible = { baseUnit: string; conversions?: Record<string, string> };
export function parseDecimal(v: unknown): Decimal {
  const m = typeof v === 'string' ? /^(0|[1-9][0-9]{0,29})(?:\.([0-9]{1,6}))?$/.exec(v) : null;
  if (!m) throw new Error('INVALID_QUANTITY');
  const frac = m[2] ?? '';
  return { n: BigInt(m[1]! + frac), scale: frac.length };
}
/** Portions / counts in thousandths (at most 3 decimals): half and quarter portions are exact, anything finer is refused. */
export function milli(v: unknown): bigint {
  const d = parseDecimal(v);
  if (d.scale > 3) throw new Error('INVALID_QUANTITY');
  return d.n * 10n ** BigInt(3 - d.scale);
}
/** value x numerator / denominator, refused unless it is a whole number: stock never holds a fraction of a base unit. */
export function exact(d: Decimal, numerator: bigint, denominator = 1n): bigint {
  const num = d.n * numerator, den = 10n ** BigInt(d.scale) * denominator;
  if (num % den !== 0n) throw new Error('INEXACT_QUANTITY');
  return num / den;
}
/**
 * Quantity in a declared unit -> whole base units. A custom unit (`conversions: {bag:'25000'}` = 1 bag is 25000 base units) wins; otherwise both units must share a
 * dimension. kg -> piece without a declared conversion is UOM_CONVERSION_MISSING, never a guess.
 */
export function toBase(item: Convertible, quantity: string, unit: string = item.baseUnit): string {
  const d = parseDecimal(quantity), custom = item.conversions?.[unit];
  if (unit === item.baseUnit) return String(exact(d, 1n));
  if (custom !== undefined) return String(exact(d, BigInt(custom)));
  const from = UNITS[unit], to = UNITS[item.baseUnit];
  if (!from) throw new Error('UNKNOWN_UNIT');
  if (!to || to.dimension !== from.dimension) throw new Error('UOM_CONVERSION_MISSING');
  return String(exact(d, from.factor, to.factor));
}
