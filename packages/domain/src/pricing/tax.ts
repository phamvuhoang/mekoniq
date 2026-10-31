import { canonicalMinor } from '../shared/money';
function rate(rateBps:number):bigint {
  if (!Number.isInteger(rateBps) || rateBps < 0) throw new Error('INVALID_RATE');
  return BigInt(rateBps);
}
/** amount * rateBps / 10000, rounded half-up. Amounts are non-negative minor units. */
export function quoteTaxExclusive(baseMinor:string, rateBps:number):string {
  const r = rate(rateBps), base = BigInt(canonicalMinor(baseMinor));
  if (base < 0n) throw new Error('INVALID_AMOUNT');
  return String((base * r + 5000n) / 10000n);
}
/** Tax already contained in a tax-inclusive gross amount: gross * rate / (10000 + rate), half-up. */
export function extractTaxInclusive(grossMinor:string, rateBps:number):string {
  const r = rate(rateBps), gross = BigInt(canonicalMinor(grossMinor));
  if (gross < 0n) throw new Error('INVALID_AMOUNT');
  const d = 10000n + r;
  return String((2n * gross * r + d) / (2n * d));
}
