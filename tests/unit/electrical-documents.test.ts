import {describe,expect,test} from 'vitest';
import {compileElectrical} from '../../packages/lab-runtime/src/engineering/electrical/compile';
import {ELECTRICAL_DOCUMENTS,renderElectricalDocuments} from '../../packages/lab-runtime/src/engineering/electrical/documents';
import {shippedContext} from '../support/electrical';

const build=async(option:'serve-hw-a-v1'|'serve-hw-b-v1'|'serve-hw-c-v1')=>{
 const {context,policy,safety,catalog}=await shippedContext(option),r=compileElectrical({design:context.design,resolved:context.resolved,project:context.project,catalog,policy,safety,driveAxisIds:['amr-1/wheel-left','amr-1/wheel-right'],schemaHash:'7'.repeat(64)});
 return {bundle:r.bundle!,profiles:context.profiles};
};
const text=(d:{bytes:Uint8Array}[],i:number)=>new TextDecoder().decode(d[i]!.bytes);

describe('documents of a compiled bundle',()=>{
 test('seven files, byte-identical on a second render, each starting with the bundle digest and compiler version',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1'),a=renderElectricalDocuments(bundle,profiles),b=renderElectricalDocuments(bundle,profiles);
  expect(a.map(d=>d.path)).toEqual([...ELECTRICAL_DOCUMENTS]);
  a.forEach((d,i)=>{expect(Buffer.from(d.bytes).equals(Buffer.from(b[i]!.bytes))).toBe(true);expect(text(a,i).split('\n')[0]).toContain(`${bundle.digest} electrical-compiler/1`);});
 });
 test('every file ends with the fixed limit line and a newline',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1'),docs=renderElectricalDocuments(bundle,profiles);
  docs.forEach((_,i)=>{const t=text(docs,i);expect(t.endsWith('\n')).toBe(true);expect(t.trimEnd().split('\n').pop()).toContain('không thay thế đo điện hay đánh giá an toàn');});
 });
 test('the wire list has one row per wire and the documented columns',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1'),rows=text(renderElectricalDocuments(bundle,profiles),1).split('\n').filter(l=>l&&!l.startsWith('#'));
  expect(rows[0]).toBe('id,net,from,to,csa_mm2,colour,length_m,current_a,csa_source');expect(rows.length-1).toBe(bundle.netlist.wires.length);
 });
 test('the bench checklist has exactly one item per unverified check',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1');
  expect(text(renderElectricalDocuments(bundle,profiles),5).split('\n').filter(l=>l.startsWith('- [ ]')).length).toBe(bundle.checks.filter(c=>c.level==='unverified').length);
 });
 test('the allocation file lists what was not allocated with its reason code',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1');
  expect(text(renderElectricalDocuments(bundle,profiles),0)).toMatch(/- brake-release: .*DIRECTION_MISMATCH/);
 });
 test('the pin-out marks pins of safety nets as review only and lists every pin of every device',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1'),t=text(renderElectricalDocuments(bundle,profiles),2);
  expect(t).toContain('estop-button,C,S1,S1,sto,safety/req-estop (review)');
  expect(t.split('\n').filter(l=>l&&!l.startsWith('#')).length-1).toBe([...profiles.values()].reduce((n,p)=>n+p.connectors.reduce((m,c)=>m+c.pins.length,0),0)+0);
 });
 test('the harness description has only the four WireViz sections',async()=>{
  const {bundle,profiles}=await build('serve-hw-c-v1'),t=text(renderElectricalDocuments(bundle,profiles),6);
  expect(t.split('\n').filter(l=>/^[a-z]+:/.test(l)).map(l=>l.replace(':',''))).toEqual(['metadata','connectors','cables','connections']);
 });
 test('a blocked bundle has no documents',async()=>{
  const {bundle,profiles}=await build('serve-hw-a-v1');
  expect(()=>renderElectricalDocuments(bundle,profiles)).toThrow('ELECTRICAL_BUNDLE_BLOCKED');
 });
});
