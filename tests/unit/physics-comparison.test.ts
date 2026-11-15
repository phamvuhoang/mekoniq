import {expect,test} from 'vitest';
import type {RunReport} from '../../packages/lab-runtime/src/v2/report';
import type {RobotPhysicalModelV1} from '../../packages/lab-runtime/src/v2/navigation2d/contracts';
import {comparePhysicsRuns} from '../../packages/lab-runtime/src/v2/simulation3d/physics-comparison';
test('missing verified native evidence is unavailable, never a zero physics effect',()=>{
 const c=comparePhysicsRuns({} as never,{} as never);expect(c.comparable).toBe(false);expect(c.reasons).toContain('EVIDENCE_INVALID');expect(c.deltas).toEqual([]);expect(c.percentiles).toBeNull();
});
import {afterAll,beforeAll} from 'vitest';
import {compileStudy,unitRun,artifact} from '../support/simulation-study';
let base:Awaited<ReturnType<typeof unitRun>>,slow:typeof base,fast:typeof base;
const compiled:Awaited<ReturnType<typeof compileStudy>>[]=[];
beforeAll(async()=>{for(const id of ['payload-center-v1','payload-slow-v1','payload-fast-v1']){const c=await compileStudy(id);compiled.push(c);}base=await unitRun(compiled[0]!);slow=await unitRun(compiled[1]!,'unit-slow');fast=await unitRun(compiled[2]!,'unit-fast');});
afterAll(async()=>{for(const c of compiled)await c.close();});
test.each([['default','slow'],['default','fast'],['slow','fast']])('accepts only registered speed caps and their completely verified derived references: %s / %s',(a,b)=>{
 const runs={default:base,slow,fast};const c=comparePhysicsRuns(runs[a as keyof typeof runs],runs[b as keyof typeof runs]);expect(c.reasons).toEqual([]);expect(c.comparable).toBe(true);expect(c.percentiles).toBeNull();expect(c.population).toMatchObject({runsA:1,runsB:1});expect(c.deltas.length).toBeGreaterThan(0);
});
test('adjacent geometry/contact/controller changes with stale upstream seals are rejected as corrupted inputs',()=>{
 for(const [path,mutate]of [['physical-model/amr-1.json',(d:RobotPhysicalModelV1)=>d.links[0].massKg.value+=1],['drive-contact-profile.json',(d:{contact:{sliding:number}})=>d.contact.sliding+=.01],['mobile-controller-policy.json',(d:{ramp:string})=>d.ramp='measured-velocity']] as const){
  const copy=structuredClone(slow),i=copy.artifacts.findIndex(a=>a.ref.path===path),doc=JSON.parse(copy.artifacts[i]!.content);mutate(doc);copy.artifacts[i]=artifact(path,doc);expect(comparePhysicsRuns(base,copy).comparable).toBe(false);
 }
});
test('unmatched clock/window and engine/controller identities have no causal deltas',()=>{
 for(const mutate of [(r:RunReport)=>r.outcome.tick++, (r:RunReport)=>r.navigation2d!.controller.version='future', (r:RunReport)=>{if(r.navigation2d!.engine.id==='mujoco_3d')Object.assign(r.navigation2d!.engine,{engineVersion:'future'});}, (r:RunReport)=>r.manifest.seed++]){
  const copy=structuredClone(slow),r=JSON.parse(copy.report.content);mutate(r);copy.report=artifact('report.json',r);const c=comparePhysicsRuns(base,copy);expect(c.comparable).toBe(false);expect(c.deltas.every((d)=>d.delta===null)).toBe(true);
 }
});
test('a rehashed report cannot invent measured metrics or omit the raw physics stream',()=>{
 const copy=structuredClone(slow),r=JSON.parse(copy.report.content);r.physicsEvidence.metrics.maxTiltRad.value=123;copy.report=artifact('report.json',r);expect(comparePhysicsRuns(base,copy).comparable).toBe(false);
 const missing=structuredClone(slow);missing.artifacts=missing.artifacts.filter(a=>!a.ref.path.startsWith('physics/'));expect(comparePhysicsRuns(base,missing).comparable).toBe(false);
});
