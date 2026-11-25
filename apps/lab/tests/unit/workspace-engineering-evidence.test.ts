import 'fake-indexeddb/auto';
import {afterEach,expect,test,vi} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
import type {RunReport,TwinRuntime} from '../../src/scenarios/controls';
import type {SavedEvidence} from '../../src/reports/evidence';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
vi.stubGlobal('innerWidth',600);
const nodes=new Map<string,unknown>();
vi.stubGlobal('document',{querySelector:()=>null,getElementById:(id:string)=>nodes.get(id)??null,activeElement:null});
const {TwinWorkspace}=await import('../../src/ui/workspace');
const {presetById}=await import('../../src/scenarios/catalog');
const {captureEvidence}=await import('../../src/reports/evidence');
afterEach(()=>nodes.clear());
const P1='a'.repeat(64),P2='b'.repeat(64);
function saved():SavedEvidence {
  const {report}=coffeeReplay(),r=structuredClone(report) as RunReport;
  r.manifest.engineering={bundleDigest:'1'.repeat(64),projectDigest:P1};
  return captureEvidence(r,structuredClone(presetById('coffee')!.project));
}
function evidenceStatusText(current:string|undefined) {
  const w=new TwinWorkspace(()=>{},{paired:false} as TwinRuntime,()=>current);
  Object.assign(w as unknown as {saved:SavedEvidence[]},{saved:[saved()]});
  const html=(w as unknown as {evidenceHtml():string}).evidenceHtml();
  return /data-testid="evidence-status">([^<]*)</.exec(html)![1]!;
}
test('saved engineering evidence matches the design the Assembly page holds and goes stale only when that design changes',()=>{
  expect(evidenceStatusText(P1)).toContain('inputs match');
  expect(evidenceStatusText(P2)).toMatch(/stale evidence: assembly/);
  expect(evidenceStatusText(undefined)).toMatch(/stale evidence: assembly/);   // no known current design is not proof the evidence still applies
});
