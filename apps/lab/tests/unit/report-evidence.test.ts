import 'fake-indexeddb/auto';
import {expect,test,vi} from 'vitest';
import {coffeeReplay} from '../support/coffee-replay';
vi.stubGlobal('localStorage',{getItem:()=>'en',setItem:()=>{}});
const {presetById}=await import('../../src/scenarios/catalog');
const evidence=await import('../../src/reports/evidence').catch(()=>null);
test('saved reports remain immutable while geometry/world/recipe/profile edits stale only the corresponding scope',async()=>{
 expect(evidence).not.toBeNull();
 const {report}=coffeeReplay(),project=structuredClone(presetById('coffee')!.project),saved=evidence!.captureEvidence(report,project),before=JSON.stringify(saved);
 for(const [scope,edit] of [
  ['model',(p:typeof project)=>{p.entities[0]!.assetRef.contentHash='1'.repeat(64);}],
  ['world',(p:typeof project)=>{p.world.points[0]!.x+=1;}],
  ['recipe',(p:typeof project)=>{p.entities.find(e=>e.kind==='coffee_machine')!.recipeRefs=[{id:'espresso',revision:2,hash:'2'.repeat(64)}];}],
  ['profile',(p:typeof project)=>{(p.entities[0]! as typeof p.entities[number]&{speedLimitMps:number}).speedLimitMps=0.2;}],
 ] as const){const changed=structuredClone(project);edit(changed);expect(evidence!.evidenceStatus(saved,changed)).toMatchObject({stale:true,scopes:[scope]});}
 expect(evidence!.evidenceStatus(saved,{...project,name:'renamed'})).toMatchObject({stale:false,scopes:[]});expect(JSON.stringify(saved)).toBe(before);
 const store=new evidence!.EvidenceStore(`evidence-${crypto.randomUUID()}`);await store.save(saved);await store.close();
 const reopened=new evidence!.EvidenceStore(store.name);expect(await reopened.list()).toEqual([saved]);
 const tampered=structuredClone(saved);tampered.report.outcome.served='999';await expect(reopened.save(tampered)).rejects.toThrow('EVIDENCE_HASH_MISMATCH');expect((await reopened.list())[0]!.report.outcome.served).toBe('1');await reopened.close();
});
