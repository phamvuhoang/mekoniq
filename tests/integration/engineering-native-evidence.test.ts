import {expect,test} from 'vitest';
import {assessEngineeringEvidence,ENGINEERING_TOPICS} from '../../packages/lab-runtime/src/v2/sil/engineering-native';
const bag=()=>({storageId:'sqlite3',topics:Object.fromEntries(ENGINEERING_TOPICS.map(topic=>[topic,{count:10,firstNs:'1000000000',lastNs:'2000000000',maxGapNs:'100000000'}]))});
const coverage=()=>({clockMapping:[{providerSimNs:'1000000000',sourceTick:0,receiveMonotonicNs:'100'},{providerSimNs:'2000000000',sourceTick:50,receiveMonotonicNs:'1000000100'}],bag:bag(),producer:'native',blockers:[]});
test('a bag needs actual expected topics and full provider-clock time coverage',()=>{
 expect(assessEngineeringEvidence(coverage()).result).toBe('pass');
 const absent=coverage();delete (absent.bag.topics as Record<string,unknown>)['/amr_1/scan'];expect(assessEngineeringEvidence(absent).blockers).toContain('BAG_TOPIC_MISSING:/amr_1/scan');
 const late=coverage();late.bag.topics['/amr_1/scan']!.firstNs='1700000000';expect(assessEngineeringEvidence(late).blockers).toContain('BAG_TIME_COVERAGE:/amr_1/scan');
 const gap=coverage();gap.bag.topics['/clock']!.maxGapNs='700000000';expect(assessEngineeringEvidence(gap).blockers).toContain('BAG_TIME_COVERAGE:/clock');
});
test('protocol doubles, clock reset and no clock cannot qualify native evidence',()=>{
 expect(assessEngineeringEvidence({...coverage(),producer:'protocol_double'}).result).toBe('not_run');
 expect(assessEngineeringEvidence({...coverage(),clockMapping:[]}).result).toBe('not_run');
 const reset=coverage();reset.clockMapping[1]!.providerSimNs='0';expect(assessEngineeringEvidence(reset).blockers).toContain('CLOCK_MAPPING_INVALID');
});

test('canonical handoff requires matching native artifact mapping and still needs host qualification',async()=>{
 const {nativeHandoffFixture}=await import('../fixtures/native-handoff');
 const {validateNativeHandoff}=await import('../../packages/lab-runtime/src/v2/sil/native-handoff');
 const {readFile,rm}=await import('node:fs/promises');
 const f=await nativeHandoffFixture('ros_navigation');
 try{
  const base='robotics/simulation/fixtures/engineering-navigation-v1';
  for(const name of ['compiler-manifest.json','native-mapping.json'])await f.put('engine','native/'+name,await readFile(base+'/'+name),base+'/'+name);
  await f.reseal();const r=await validateNativeHandoff(f.root,f.manifest,f.inventory);
  expect(r.issues.map(x=>x.code)).not.toContain('NATIVE_ENGINE_MAPPING_UNRESOLVED');
  expect(r.issues.map(x=>x.code)).toContain('NATIVE_ARTIFACT_CLOSURE_MISSING');
  expect(r.nativeReady).toBe(false);
 }finally{await rm(f.root,{recursive:true,force:true});}
});

test('negative cases require observed fault, no served business outcome, and no replay',async()=>{
 const {assessEngineeringFault}=await import('../../packages/lab-runtime/src/v2/sil/engineering-native');
 const observed={nativeCase:'cancel',fault:{status:'applied',commandId:'c1'},status:'needs_attention',served:'0',effects:[{attempts:1}],observedCompleted:0};
 expect(assessEngineeringFault(observed).result).toBe('pass');
 expect(assessEngineeringFault({...observed,served:'1'}).result).toBe('fail');
 expect(assessEngineeringFault({...observed,fault:{status:'intent'}}).result).toBe('not_run');
 expect(assessEngineeringFault({...observed,effects:[{attempts:2}]}).result).toBe('fail');
});
