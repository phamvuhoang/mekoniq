export interface PriceLine {
  id: string;
  quantity: number;
  priceMinor: string | null;
  currency?: string;
}

/** VND minor units are whole đồng. Convert currencies explicitly before calling. */
export function calculateBom(lines: readonly PriceLine[], currency: string): {totalMinor:string|null;missingIds:string[]} {
  let total=0n;
  const missingIds:string[]=[];
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error('INVALID_QUANTITY');
    if (line.currency && line.currency !== currency) throw new Error('CURRENCY_CONVERSION_REQUIRED');
    if (line.priceMinor === null) { missingIds.push(line.id); continue; }
    if (!/^\d+$/.test(line.priceMinor)) throw new Error('INVALID_MINOR_UNITS');
    total += BigInt(line.priceMinor) * BigInt(line.quantity);
  }
  return {totalMinor:missingIds.length ? null : total.toString(),missingIds:[...new Set(missingIds)]};
}
