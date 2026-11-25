import {describe,expect,test} from 'vitest';
import {readFile} from 'node:fs/promises';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import {compareOptions} from '../../packages/lab-runtime/src/engineering/electrical/tco';
import type {TcoAssumptionsV1} from '../../packages/lab-runtime/src/engineering/electrical/contracts';
import {shippedContext} from '../support/electrical';

type Opt='serve-hw-a-v1'|'serve-hw-b-v1'|'serve-hw-c-v1';
const bundle=async(option:Opt,price?:{amount:number;currency:string})=>{
 const {context,policy,safety,catalog}=await shippedContext(option);
 if(price)for(const p of Object.values(catalog.deviceProfiles))catalog.quotes[p.component.digest]={...price,quotedOn:'2026-11-25'};
 return compileElectrical({design:context.design,resolved:context.resolved,project:context.project,catalog,policy,safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64)}).bundle!;
};
const shipped=async()=>JSON.parse(await readFile('robotics/catalog/electrical/tco-assumptions-v1.json','utf8')) as TcoAssumptionsV1;
const priced=(a:TcoAssumptionsV1):TcoAssumptionsV1=>({...a,wirePricePerM:1,connectorPrice:2});

describe('comparison',()=>{
 test('with no quotation nothing is compared, the missing lines are listed, and the parts that need no price are still computed',async()=>{
  const r=compareOptions([await bundle('serve-hw-b-v1'),await bundle('serve-hw-c-v1')],await shipped());
  expect(r.notComparableReason).toBe('PRICE_MISSING_FOR_DECIDING_PARTS');
  for(const o of r.options){expect(o.comparable).toBe(false);expect(o.total).toBeNull();expect(o.parts.hardware).toBeNull();expect(o.parts.assembly).toBeGreaterThan(0);expect(o.parts.testing).toBeGreaterThan(0);expect(o.parts.downtime).toBe(80);expect(o.missingPriceLineIds.length).toBeGreaterThan(5);}
  expect(r.dominant!.factor).toBe('assembly');
 });
 test('a blocked bundle is named as the reason',async()=>{
  const r=compareOptions([await bundle('serve-hw-a-v1'),await bundle('serve-hw-c-v1')],await shipped());expect(r.notComparableReason).toBe('BUNDLE_BLOCKED');
 });
 test('with every part priced in one currency the total is the sum of six parts and the dominant part is the one that differs most',async()=>{
  const price={amount:100,currency:'USD'},a=priced(await shipped()),r=compareOptions([await bundle('serve-hw-b-v1',price),await bundle('serve-hw-c-v1',price)],a);
  expect(r.notComparableReason).toBeNull();
  for(const o of r.options){expect(o.comparable).toBe(true);expect(o.total).toBeCloseTo(Object.values(o.parts).reduce<number>((s,x)=>s+(x as number),0),9);}
  const spreads=Object.fromEntries((['hardware','wiring','assembly','testing','service','downtime'] as const).map(f=>{const v=r.options.map(o=>o.parts[f]!);return [f,Math.max(...v)-Math.min(...v)];}));
  expect(spreads[r.dominant!.factor]).toBeCloseTo(r.dominant!.spread,9);expect(r.dominant!.spread).toBe(Math.max(...Object.values(spreads)));
 });
 test('quotations in two currencies are not compared',async()=>{
  const a=priced(await shipped()),r=compareOptions([await bundle('serve-hw-b-v1',{amount:100,currency:'USD'}),await bundle('serve-hw-c-v1',{amount:100,currency:'EUR'})],a);
  expect(r.notComparableReason).toBe('CURRENCY_MISMATCH');expect(r.options.every(o=>o.total===null)).toBe(true);
 });
 test('the comparison is deterministic',async()=>{
  const bs=[await bundle('serve-hw-b-v1'),await bundle('serve-hw-c-v1')],a=await shipped();
  expect(JSON.stringify(compareOptions(bs,a))).toBe(JSON.stringify(compareOptions(bs,a)));
 });
});
