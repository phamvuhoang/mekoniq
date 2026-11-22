import {expect,test} from 'vitest';
import {groupMaturity,modelMaturity,MATURITY_GROUPS} from '../../packages/lab-runtime/src/engineering/maturity';
import type {CalibrationRecordV1} from '../../packages/lab-runtime/src/engineering/calibration-record';

import {sealDriveDocument} from '../../packages/lab-runtime/src/v2/control/drive-io';
const d=(c:string)=>c.repeat(64),DATASET=d('a'),C='c1'.repeat(32);
const src=(kind:'assumed'|'manufacturer'|'derived'|'measured',o:Record<string,unknown>={})=>({kind,documentId:'d',revision:'1',locator:'l',contentSha256:DATASET,...o});
/** a derived source exactly as buildRevision writes it: the fit it came from, the fitted path, the revision it created */
const derived=(o:Record<string,unknown>={})=>src('derived',{documentId:`calibration-fit:${d('f')}`,revision:'2',locator:'fitted:armatureKgM2[0]',...o});
/** a schema-valid, sealed record (the maturity function refuses anything else) */
const rec=(o:Record<string,unknown>={})=>sealDriveDocument({schemaVersion:1,documentType:'calibration-record',planDigest:d('1'),datasetDigest:DATASET,configDigest:C,baseDriveModelDigest:d('4'),fitDigest:d('f'),sourceKind:'measured',
 fitted:[{path:'armatureKgM2[0]',value:0.13,atBound:false,unit:'kg*m^2',standardError:0.001}],convergence:{iterations:3,converged:true,objectiveInitial:2,objectiveFinal:1e-3,jacobianCondition:5},
 validation:{status:'pass',reasons:[],residuals:{},domain:{},calibratedCapabilities:[],invalidatedBy:null},domain:{},produced:[{document:'arm_physics',id:'p',revision:2,digest:d('b')}],reasonCodes:[],toolSelfTest:false,accepted:false,...o}) as unknown as CalibrationRecordV1;

test('a group is only as mature as its weakest parameter',()=>{
 expect(groupMaturity([src('manufacturer'),src('assumed')],[],C)).toBe('assumed');
 expect(groupMaturity([src('assumed'),src('assumed')],[],C)).toBe('assumed');
 expect(groupMaturity([src('manufacturer')],[],C)).toBe('nominal');
 expect(groupMaturity([src('manufacturer'),src('measured')],[],C)).toBe('nominal');
 expect(groupMaturity([src('measured')],[],C)).toBe('calibrated');
 expect(groupMaturity([],[],C),'a group with no source is not known to be anything better than assumed').toBe('assumed');
});
test('a derived parameter is calibrated only while its record is valid for the current configuration',()=>{
 expect(groupMaturity([derived()],[rec()],C)).toBe('calibrated');
 expect(groupMaturity([derived()],[rec()],'c2'.repeat(32))).toBe('assumed');
});
const result=(status:string)=>({status,reasons:status==='pass'?[]:['x'],residuals:{},domain:{},calibratedCapabilities:[],invalidatedBy:null});
test('a record that does not pass, is synthetic, is the tool self-test, produced nothing, or is about another dataset lifts nothing (each a valid document, so the reason is the rule and not the schema)',()=>{
 const cases:Record<string,unknown>[]=[{validation:result('fail'),produced:[],reasonCodes:['VALIDATION_FAILED']},{validation:result('not_run'),produced:[],reasonCodes:['VALIDATION_FAILED']},{sourceKind:'synthetic',produced:[],reasonCodes:['SYNTHETIC_DATA']},
  {sourceKind:'synthetic',toolSelfTest:true,produced:[],reasonCodes:['TOOL_SELF_TEST']},{produced:[]},{datasetDigest:'e'.repeat(64)}];
 for(const o of cases)expect(groupMaturity([derived()],[rec(o)],C),JSON.stringify(o)).toBe('assumed');
 expect(groupMaturity([derived()],[rec(cases[0]),rec()],C),'one valid record among others is enough').toBe('calibrated');
});
test('R07: a derived source is lifted only by the fit it names, for the path it names, and the revision it names: another fit on the same dataset lifts nothing',()=>{
 expect(groupMaturity([derived({documentId:`calibration-fit:${d('9')}`})],[rec()],C),'another fit digest').toBe('assumed');
 expect(groupMaturity([derived({locator:'fitted:armatureKgM2[3]'})],[rec()],C),'a path this fit did not fit').toBe('assumed');
 expect(groupMaturity([derived({locator:'armatureKgM2[0]'})],[rec()],C),'not a fitted-path locator').toBe('assumed');
 expect(groupMaturity([derived({revision:'7'})],[rec()],C),'a revision this fit did not produce').toBe('assumed');
 expect(groupMaturity([derived({documentId:'d'})],[rec()],C),'a source that does not name a fit').toBe('assumed');
 expect(groupMaturity([derived()],[rec()],C)).toBe('calibrated');
 // a record that is not a valid, sealed document (a forged or edited one) lifts nothing
 expect(groupMaturity([derived()],[{...rec(),fitted:[{path:'armatureKgM2[0]',value:99,atBound:false,unit:'kg*m^2',standardError:0.001}]} as unknown as CalibrationRecordV1],C)).toBe('assumed');
});
test('a model is rated per group; a mock model is illustrative everywhere whatever its sources say',()=>{
 const groups=Object.fromEntries(MATURITY_GROUPS.map(g=>[g,[src(g==='geometry'?'manufacturer':'assumed')]])) as unknown as Parameters<typeof modelMaturity>[0]['groups'];
 expect(modelMaturity({mock:false,groups,records:[],currentConfigDigest:C})).toEqual({geometry:'nominal',inertia:'assumed',drive:'assumed',contact:'assumed',sensing:'assumed'});
 expect(modelMaturity({mock:true,groups,records:[],currentConfigDigest:C})).toEqual(Object.fromEntries(MATURITY_GROUPS.map(g=>[g,'illustrative'])));
 const withDrive={...groups,drive:[derived()]};
 expect(modelMaturity({mock:false,groups:withDrive,records:[rec()],currentConfigDigest:C}).drive).toBe('calibrated');
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
