/** Value of `baseQty` base units bought at `unitCostMinor` per ordering unit (`perBase` base units per ordering unit), rounded half up; integer end to end. */
export const lineValue = (baseQty: bigint, unitCostMinor: bigint, perBase: bigint): bigint => (baseQty * unitCostMinor * 2n + perBase) / (2n * perBase);
