import type { Money } from '../../../contracts/src/index';
const MINOR_PATTERN = /^(0|[1-9][0-9]{0,29}|-[1-9][0-9]{0,29})$/;

export function canonicalMinor(minor: string): string {
  if (typeof minor !== 'string' || !MINOR_PATTERN.test(minor)) throw new Error('INVALID_MINOR');
  return minor;
}

export function sumMoney(values: Money[]): Money {
  if (!values.length) throw new Error('EMPTY_MONEY');
  const currency = values[0]!.currency;
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('INVALID_CURRENCY');
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) throw new Error('CURRENCY_MISMATCH');
    total += BigInt(canonicalMinor(value.minor));
  }
  return { currency, minor: canonicalMinor(String(total)) };
}

/** Largest remainder allocation; equal remainder ties use the original array index. */
export function allocateMinor(total: string, weights: bigint[]): string[] {
  const amount = BigInt(canonicalMinor(total));
  if (!weights.length || weights.some(weight => typeof weight !== 'bigint' || weight < 0n) || amount < 0n)
    throw new Error('INVALID_ALLOCATION');
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum <= 0n) throw new Error('INVALID_ALLOCATION');
  const base = weights.map(weight => amount * weight / sum);
  let rest = amount - base.reduce((a, b) => a + b, 0n);
  const rank = weights.map((weight, index) => ({ index, remainder: amount * weight % sum }))
    .sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (const { index } of rank) {
    if (rest <= 0n) break;
    base[index] = base[index]! + 1n;
    rest--;
  }
  return base.map(String);
}
