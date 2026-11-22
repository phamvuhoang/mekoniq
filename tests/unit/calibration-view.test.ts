import {beforeEach,expect,test,vi} from 'vitest';
vi.hoisted(()=>{(globalThis as Record<string,unknown>).localStorage={getItem:()=>'en',setItem:()=>{}};(globalThis as Record<string,unknown>).document={documentElement:{lang:'en'}};});
import {setLocale} from '../../src/i18n';
import {calibrationHtml,readCalibrationFile} from '../../src/reports/calibration';

const d=(c:string)=>c.repeat(64),CONFIG=d('c');
const result=(o:Record<string,unknown>={})=>({status:'pass',reasons:[],residuals:{position:{samples:312,meanAbs:6.4e-5,maxAbs:2.3e-4,withinTolerance:true}},domain:{position:{min:-1.14,max:-0.25}},calibratedCapabilities:['actuator'],invalidatedBy:null,...o});
const record=(o:Record<string,unknown>={})=>({schemaVersion:1,documentType:'calibration-record',digest:d('1'),planDigest:d('2'),datasetDigest:d('3'),configDigest:CONFIG,baseDriveModelDigest:d('4'),fitDigest:d('5'),sourceKind:'measured',
 fitted:[{path:'armatureKgM2[2]',value:0.1304,atBound:false,unit:'kg*m^2',standardError:0.001},{path:'jointDynamics.damping',value:3,atBound:true,unit:'N*m*s/rad',standardError:null}],
 convergence:{iterations:3,converged:true,objectiveInitial:20.7,objectiveFinal:3.97,jacobianCondition:7.5},validation:result(),domain:{position:{min:-1.14,max:-0.25}},produced:[],reasonCodes:['PARAMETER_AT_BOUND'],toolSelfTest:false,accepted:false,...o});
const current={configDigests:{'xarm-1/J3':CONFIG,'xarm-1/J2':d('9')}};
beforeEach(()=>setLocale('en'));

test('no file: the screen says there is no calibration data, and nothing else',()=>{
 const html=calibrationHtml(null,null);
 expect(html).toContain('data-testid="calibration-empty"');expect(html).toMatch(/no calibration data/i);expect(html).not.toContain('data-testid="calibration-record"');
});
test('a record of this plant shows its fitted values, bound flags, convergence, held-out residuals, domain and that it is valid for the plant of its axis',()=>{
 const r=readCalibrationFile(JSON.stringify(record()),current);expect(r.ok).toBe(true);if(!r.ok)return;
 expect(r.view).toMatchObject({validity:'valid',axisId:'xarm-1/J3',label:'measured'});
 const html=calibrationHtml(r.view,null);
 expect(html).toContain('data-testid="calibration-record"');expect(html).toContain('armatureKgM2[2]');expect(html).toContain('<td>0.13</td>');
 expect(html).toMatch(/at bound/i);expect(html).toContain('data-bound="true"');expect(html).toContain('PARAMETER_AT_BOUND');
 expect(html).toContain('data-testid="calibration-residuals"');expect(html).toContain('312');expect(html).toContain('data-testid="calibration-domain"');
 expect(html).toMatch(/valid for/i);expect(html).toMatch(/xarm-1\/J3/);expect(html).toMatch(/no revision/i);expect(html).not.toMatch(/safe|certified|approved/i);
});
test('a record of another plant or configuration is refused with its reason and shows no fitted values',()=>{
 const r=readCalibrationFile(JSON.stringify(record({configDigest:d('e')})),current);
 expect(r).toEqual({ok:false,reason:'CONFIG_DIGEST_MISMATCH'});
 const html=calibrationHtml(null,'CONFIG_DIGEST_MISMATCH');expect(html).toContain('data-testid="calibration-error"');expect(html).toContain('CONFIG_DIGEST_MISMATCH');expect(html).not.toContain('armatureKgM2');
});
test('a synthetic record is labelled a tool self-test and never reads as measured',()=>{
 const r=readCalibrationFile(JSON.stringify(record({sourceKind:'synthetic',toolSelfTest:true,reasonCodes:['SYNTHETIC_DATA','TOOL_SELF_TEST'],fitted:[{path:'armatureKgM2[2]',value:0.13,atBound:false,unit:'kg*m^2',standardError:0.001}]})),current);
 expect(r.ok).toBe(true);if(!r.ok)return;expect(r.view.label).toBe('self_test');
 const html=calibrationHtml(r.view,null);expect(html).toContain('data-label="self_test"');expect(html).toMatch(/tool self-test/i);expect(html).toMatch(/not measured/i);
 const plain=readCalibrationFile(JSON.stringify(record({sourceKind:'synthetic',toolSelfTest:false})),current);expect(plain.ok&&plain.view.label).toBe('synthetic');
});
test('without a runtime the configuration cannot be checked: the record is shown as not checked, not as valid',()=>{
 const r=readCalibrationFile(JSON.stringify(record()),{configDigests:null});expect(r.ok).toBe(true);if(!r.ok)return;
 expect(r.view.validity).toBe('unchecked');expect(calibrationHtml(r.view,null)).toMatch(/not checked/i);
});
test('a file that is not a record, has a changed type, claims accepted:true, or is too large is refused by name',()=>{
 for(const [text,why] of [['not json','CALIBRATION_FILE_INVALID'],['{}','CALIBRATION_FILE_INVALID'],[JSON.stringify({...record(),accepted:true}),'CALIBRATION_FILE_INVALID'],[JSON.stringify({...record(),documentType:'other'}),'CALIBRATION_FILE_INVALID'],
  [JSON.stringify({...record(),fitted:[{path:1}]}),'CALIBRATION_FILE_INVALID'],[JSON.stringify({...record(),produced:[{document:'drive_model'}]}),'CALIBRATION_FILE_INVALID']] as const)expect(readCalibrationFile(text,current),text.slice(0,30)).toEqual({ok:false,reason:why});
 // a record that says it produced a revision although it did not pass is not a record the tool could have written
 expect(readCalibrationFile(JSON.stringify(record({validation:result({status:'fail'}),produced:[{document:'arm_physics',id:'x',revision:2,digest:d('7')}]})),current)).toEqual({ok:false,reason:'CALIBRATION_FILE_INVALID'});
 expect(readCalibrationFile(JSON.stringify(record({sourceKind:'synthetic',produced:[{document:'arm_physics',id:'x',revision:2,digest:d('7')}]})),current)).toEqual({ok:false,reason:'CALIBRATION_FILE_INVALID'});
});
test('a comparison file draws the measured and the predicted trace of a held-out trial with a table alternative; without series it says so',()=>{
 const times=Array.from({length:20},(_,k)=>k*10_000_000),meas=times.map((_,k)=>0.1*(1-Math.exp(-k/6))),pred=meas.map(v=>v*1.02);
 const bundle={record:record(),dataset:{trials:[{trialId:'v1',split:'validation',condition:'step',timesNs:times,channels:{position:meas}},{trialId:'t1',split:'tune',condition:'step',timesNs:times,channels:{position:meas}}],clockMapping:{domain:'sim',offsetNs:0},units:{position:'rad'}},
  prediction:{trials:[{trialId:'v1',timesNs:times,channels:{position:pred}}],units:{position:'rad'}}};
 const r=readCalibrationFile(JSON.stringify(bundle),current);expect(r.ok).toBe(true);if(!r.ok)return;
 expect(r.view.plot).toMatchObject({trialId:'v1',channel:'position',unit:'rad'});
 const html=calibrationHtml(r.view,null);expect(html).toContain('data-testid="calibration-plot"');expect(html).toContain('<svg');expect(html).toContain('data-series="measured"');expect(html).toContain('data-series="predicted"');expect(html).toContain('plot-table');
 const bare=readCalibrationFile(JSON.stringify(record()),current);expect(bare.ok&&bare.view.plot).toBeNull();expect(calibrationHtml(bare.ok?bare.view:null,null)).toMatch(/no measured\/predicted series/i);
});
test('the three languages all have the words (no key falls back to Vietnamese in English)',()=>{
 const r=readCalibrationFile(JSON.stringify(record()),current);if(!r.ok)return;
 setLocale('ja');const ja=calibrationHtml(r.view,null);setLocale('vi');const vi_=calibrationHtml(r.view,null);setLocale('en');const en=calibrationHtml(r.view,null);
 expect(new Set([ja,vi_,en]).size).toBe(3);expect(en).not.toMatch(/[À-ỹ]{2}/);   // no Vietnamese diacritics in English
});
test('every value from the file is escaped',()=>{
 const r=readCalibrationFile(JSON.stringify(record({fitted:[{path:'<img src=x onerror=1>',value:1,atBound:false,unit:'<b>',standardError:null}]})),current);
 // an unregistered path is still shown (the Lab does not own the registry) but never as markup
 if(r.ok){const html=calibrationHtml(r.view,null);expect(html).not.toContain('<img');expect(html).not.toContain('<b>');}
});
