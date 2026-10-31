import { expect, test } from 'vitest';
import fc from 'fast-check';
import { allocateMinor, sumMoney, canonicalMinor } from '../../packages/domain/src/shared/money';
import { addQuantity } from '../../packages/domain/src/shared/quantity';

test('splitting preserves every minor unit with stable largest remainder', () => {
  expect(allocateMinor('100001', [1n, 1n, 1n])).toEqual(['33334','33334','33333']);
  expect(allocateMinor('2', [1n, 2n, 3n])).toEqual(['0','1','1']);
  expect(allocateMinor('0', [1n])).toEqual(['0']);
  expect(allocateMinor('999999999999999999999999999999', [1n, 1n, 1n])).toEqual(Array(3).fill('333333333333333333333333333333'));
});
test('allocation conserves sum for generated totals and weights', () => {
  fc.assert(fc.property(fc.bigInt({min:0n,max:10n**29n}), fc.array(fc.bigInt({min:0n,max:10000n}), {minLength:1,maxLength:20}), (total,weights) => {
    fc.pre(weights.some(w => w > 0n));
    const parts=allocateMinor(String(total),weights).map(BigInt);
    expect(parts.reduce((a,b)=>a+b,0n)).toBe(total);
    expect(parts.every(x=>x>=0n)).toBe(true);
  }), {numRuns:300});
});
test('allocation rejects negative, invalid and unbounded inputs', () => {
  for(const [total,weights] of [['-1',[1n]],['1',[0n]],['1',[]],['1',[-1n,2n]],['01',[1n]],['1'.repeat(31),[1n]]] as [string,bigint[]][])
    expect(()=>allocateMinor(total,weights)).toThrow();
});
test('money sums exact values and rejects mixed currencies or overflow', () => {
  expect(sumMoney([{currency:'VND',minor:'9007199254740993'},{currency:'VND',minor:'-1'}])).toEqual({currency:'VND',minor:'9007199254740992'});
  expect(()=>sumMoney([])).toThrow('EMPTY_MONEY');
  expect(()=>sumMoney([{currency:'VND',minor:'1'},{currency:'USD',minor:'1'}])).toThrow('CURRENCY_MISMATCH');
  expect(()=>sumMoney([{currency:'VND',minor:'9'.repeat(30)},{currency:'VND',minor:'1'}])).toThrow('INVALID_MINOR');
  expect(()=>canonicalMinor('-0')).toThrow('INVALID_MINOR');
});
test('quantities preserve unit/scale and never coerce floats', () => {
  expect(addQuantity({minor:'125',scale:2,unit:'kg'},{minor:'25',scale:2,unit:'kg'})).toEqual({minor:'150',scale:2,unit:'kg'});
  expect(()=>addQuantity({minor:'1',scale:0,unit:'kg'},{minor:'1',scale:0,unit:'piece'})).toThrow('QUANTITY_UNIT_MISMATCH');
});
