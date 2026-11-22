import {expect,test} from 'vitest';
import {groupMaturity,modelMaturity,MATURITY_GROUPS} from '../../packages/lab-runtime/src/engineering/maturity';
import type {CalibrationRecordV1} from '../../packages/lab-runtime/src/engineering/calibration-record';

const src=(kind:'assumed'|'manufacturer'|'derived'|'measured',contentSha256='a'.repeat(64))=>({kind,documentId:'d',revision:'1',locator:'l',contentSha256});
const rec=(o:Record<string,unknown>={})=>({planDigest:'p',datasetDigest:'a'.repeat(64),sourceKind:'measured',toolSelfTest:false,configDigest:'c1',validation:{status:'pass'},produced:[{document:'drive_model',id:'x',revision:2,digest:'b'.repeat(64)}],...o}) as unknown as CalibrationRecordV1;

test('a group is only as mature as its weakest parameter',()=>{
 expect(groupMaturity([src('manufacturer'),src('assumed')],[],'c1')).toBe('assumed');
 expect(groupMaturity([src('assumed'),src('assumed')],[],'c1')).toBe('assumed');
 expect(groupMaturity([src('manufacturer')],[],'c1')).toBe('nominal');
 expect(groupMaturity([src('manufacturer'),src('measured')],[],'c1')).toBe('nominal');
 expect(groupMaturity([src('measured')],[],'c1')).toBe('calibrated');
 expect(groupMaturity([],[],'c1'),'a group with no source is not known to be anything better than assumed').toBe('assumed');
});
test('a derived parameter is calibrated only while its record is valid for the current configuration',()=>{
 expect(groupMaturity([src('derived')],[rec()],'c1')).toBe('calibrated');
 expect(groupMaturity([src('derived')],[rec()],'c2')).toBe('assumed');
});
test('a record that does not pass, is synthetic, is the tool self-test, produced nothing, or is about another dataset lifts nothing',()=>{
 for(const o of [{validation:{status:'fail'}},{validation:{status:'not_run'}},{sourceKind:'synthetic'},{toolSelfTest:true},{produced:[]},{datasetDigest:'e'.repeat(64)}])
  expect(groupMaturity([src('derived')],[rec(o)],'c1'),JSON.stringify(o)).toBe('assumed');
 expect(groupMaturity([src('derived')],[rec({validation:{status:'fail'}}),rec()],'c1'),'one valid record among others is enough').toBe('calibrated');
});
test('a model is rated per group; a mock model is illustrative everywhere whatever its sources say',()=>{
 const groups=Object.fromEntries(MATURITY_GROUPS.map(g=>[g,[src(g==='geometry'?'manufacturer':'assumed')]])) as unknown as Parameters<typeof modelMaturity>[0]['groups'];
 expect(modelMaturity({mock:false,groups,records:[],currentConfigDigest:'c1'})).toEqual({geometry:'nominal',inertia:'assumed',drive:'assumed',contact:'assumed',sensing:'assumed'});
 expect(modelMaturity({mock:true,groups,records:[],currentConfigDigest:'c1'})).toEqual(Object.fromEntries(MATURITY_GROUPS.map(g=>[g,'illustrative'])));
 const withDrive={...groups,drive:[src('derived')]};
 expect(modelMaturity({mock:false,groups:withDrive,records:[rec()],currentConfigDigest:'c1'}).drive).toBe('calibrated');
});

test('the plants the runtime serves today have no calibrated group, whatever the fixtures declare: every group is as weak as its assumed parameters',async()=>{
 const {mujocoPlantSources}=await import('../../packages/lab-runtime/src/engineering/maturity');
 const root=new URL('../../robotics/simulation-mujoco',import.meta.url).pathname;
 for(const plant of ['arm','mobile'] as const){
  const groups=await mujocoPlantSources(root,plant),levels=modelMaturity({mock:false,groups,records:[],currentConfigDigest:'any'});
  expect(Object.values(levels),plant).toEqual(Array(5).fill('assumed'));
  expect(Object.values(groups).every(g=>g.length>0),'every group names at least one source').toBe(true);
 }
 // the arm's geometry and inertia do carry the manufacturer's numbers, and still rate assumed: the weakest parameter decides
 const arm=await mujocoPlantSources(root,'arm');expect(arm.inertia.some(s=>s.kind==='manufacturer')&&arm.inertia.some(s=>s.kind==='assumed')).toBe(true);
 // a source the runtime cannot read is assumed, not a better origin
 const none=await mujocoPlantSources('/nonexistent','arm');expect(none.drive.every(s=>s.kind==='assumed')).toBe(true);
});
