function checkedCost(costMinor:string):bigint {
  if (!/^\d+$/.test(costMinor)) throw new Error('INVALID_MINOR_UNITS');
  return BigInt(costMinor);
}
function basisPoints(value:number):bigint {
  if (!Number.isSafeInteger(value) || value<0) throw new Error('INVALID_BASIS_POINTS');
  return BigInt(value);
}
function ceilDiv(numerator:bigint,denominator:bigint):string {
  return ((numerator+denominator-1n)/denominator).toString();
}
/** Gross margin: ceil(cost / (1 - margin)); rounded upward to a whole minor unit. */
export function priceForMargin(costMinor:string,marginBasisPoints:number):string {
  const cost=checkedCost(costMinor);
  const margin=basisPoints(marginBasisPoints);
  if (margin>=10000n) throw new Error('MARGIN_MUST_BE_BELOW_100_PERCENT');
  return ceilDiv(cost*10000n,10000n-margin);
}
/** Markup is a separate cost multiplier, not gross margin. */
export function priceForMarkup(costMinor:string,markupBasisPoints:number):string {
  return ceilDiv(checkedCost(costMinor)*(10000n+basisPoints(markupBasisPoints)),10000n);
}
