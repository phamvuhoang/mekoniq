import {describe,expect,test} from 'vitest';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import {shippedContext} from '../support/electrical';

const compile=async(quote=false)=>{
 const {context,policy,safety,catalog}=await shippedContext('serve-hw-c-v1');
 if(quote)for(const d of Object.values(catalog.deviceProfiles))catalog.quotes[d.component.digest]={amount:10,currency:'USD',quotedOn:'2026-11-25'};
 return {context,r:compileElectrical({design:context.design,resolved:context.resolved,project:context.project,catalog,policy,safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64)})};
};

describe('extended BOM',()=>{
 test('the mechanical lines stay exactly as the assembly produced them',async()=>{
  const {context,r}=await compile();
  expect(r.bundle!.bom.lines.slice(0,context.resolved.bom.lines.length)).toEqual(context.resolved.bom.lines);
 });
 test('an electrical device line per component, with the mating parts of its connectors as accessories',async()=>{
  const {r}=await compile(),drive=r.bundle!.bom.lines.find(l=>l.lineId.startsWith('eld/drive/orientalmotor-blvd-krd'))!;
  expect(drive.qty).toBe(2);expect(drive.instanceIds).toEqual(['drive-left','drive-right']);expect(drive.requiredAccessories.some(a=>a.includes('F32FSS'))).toBe(true);expect(drive.candidate).toBe(true);
 });
 test('every mating part of every connector has a line whose qty is how many times it is used',async()=>{
  const {r}=await compile(),mate=r.bundle!.bom.lines.find(l=>l.lineId.startsWith('mate/F32FSS'))!;
  expect(mate.qty).toBe(2);expect(mate.price).toBeNull();
 });
 test('wire is grouped by cross-section and colour and measured in whole metres of the known lengths',async()=>{
  const {r}=await compile(),wire=r.bundle!.bom.lines.filter(l=>l.lineId.startsWith('wire/'));
  expect(wire.length).toBeGreaterThan(3);expect(new Set(wire.map(l=>l.lineId)).size).toBe(wire.length);expect(wire.every(l=>Number.isInteger(l.qty)&&l.qty>=1)).toBe(true);
 });
 test('without a quotation the total is unknown and every new line is listed as missing a price',async()=>{
  const {r}=await compile(),bom=r.bundle!.bom;
  expect(bom.total).toBeNull();expect(bom.incompleteTotal).toBe(true);expect(bom.missingPriceLineIds.filter(id=>id.startsWith('eld/')).length).toBeGreaterThan(8);expect(bom.missingPriceLineIds.length).toBe(bom.lines.length);
 });
 test('with quotations for the devices only, connector and wire lines keep the total incomplete',async()=>{
  const {r}=await compile(true),bom=r.bundle!.bom;
  expect(bom.lines.filter(l=>l.lineId.startsWith('eld/')).every(l=>l.price?.amount===10)).toBe(true);expect(bom.incompleteTotal).toBe(true);expect(bom.missingPriceLineIds.some(id=>id.startsWith('eld/'))).toBe(false);
 });
});
