// V15 (R4.5): the model-maturity badge and the calibration screen on the pinned runtime. One spec per launcher (one-use pairing code):
//   node scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile [--ui-port 4185 --runtime-port 4186] mujoco-calibration.spec.ts
// The records are written here (a record is a local file); nothing is uploaded and no runtime route reads one.
import {test,expect} from '@playwright/test';
import {openInspector} from '../support/twin';
import {hashJson} from '../../src/twin/hash';
import {sweepWeb07} from '../support/web07';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL;
const d=(c:string)=>c.repeat(64);
const unsealed=(o:Record<string,unknown>={})=>({schemaVersion:1,documentType:'calibration-record',digest:d('1'),planDigest:d('2'),datasetDigest:d('3'),configDigest:d('c'),baseDriveModelDigest:d('4'),fitDigest:d('5'),sourceKind:'measured',
 fitted:[{path:'armatureKgM2[2]',value:0.1304,atBound:false,unit:'kg*m^2',standardError:0.001}],convergence:{iterations:3,converged:true,objectiveInitial:20.7,objectiveFinal:3.97,jacobianCondition:7.5},
 validation:{status:'fail',reasons:['MEASURED_DATA_REQUIRED'],residuals:{},domain:{},calibratedCapabilities:[],invalidatedBy:null},domain:{position:{min:-1.14,max:-0.25}},produced:[],reasonCodes:['VALIDATION_FAILED'],toolSelfTest:false,accepted:false,...o});
/** sealed as the tool seals a record: the digest is the hash of everything else */
const record=(o:Record<string,unknown>={})=>{const {digest:_,...rest}=unsealed(o);void _;return {...rest,digest:hashJson(rest)};};
const file=(r:unknown)=>({name:'record.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(r))});

test('Control tab: the maturity badge comes from the runtime, a record of this plant is read from a file, a record of another plant is refused, a self-test is labelled, and none of them changes the badge',async({page,request,baseURL})=>{
 test.setTimeout(300000);page.setDefaultTimeout(30000);
 expect(token,'Run through scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile mujoco-calibration.spec.ts').toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const health=await (await request.get(`${runtime??baseURL}/lab/v2/health`)).json() as {modelMaturity:Record<string,Record<string,string>>;calibrationConfigDigests:Record<string,string>};
 expect(Object.keys(health.modelMaturity).sort()).toEqual(['mujoco_3d','mujoco_arm']);
 const wheel=health.calibrationConfigDigests['amr-1/wheel-left'];expect(wheel).toMatch(/^[0-9a-f]{64}$/);
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openInspector(page,'control');
 // the badge is the runtime's: the whole plant is assumed today, said in words, with every group, and it is not a typed string
 const badge=page.getByTestId('control-model-maturity');
 await expect(badge).toContainText('Model maturity: Assumed');await expect(badge).toHaveAttribute('data-level','assumed');
 for(const g of ['geometry','inertia','drive','contact','sensing'])await expect(badge.locator(`[data-group="${g}"]`)).toHaveAttribute('data-level','assumed');
 await expect(page.getByTestId('control-banner')).toContainText('Simulation · not calibrated');
 // no record yet
 await page.getByTestId('calibration-loader').locator('summary').click();
 await expect(page.getByTestId('calibration-empty')).toContainText('No calibration data yet');
 // a record of this plant (the wheel's configuration, as the runtime digests it)
 await page.locator('#twin-import-calibration').setInputFiles(file(record({configDigest:wheel})));
 await expect(page.getByTestId('calibration-record')).toHaveAttribute('data-validity','valid');
 await expect(page.getByTestId('calibration-validity')).toContainText('Valid for the configuration of axis amr-1/wheel-left');
 await expect(page.getByTestId('calibration-fitted')).toContainText('armatureKgM2[2]');await expect(page.getByTestId('calibration-reasons')).toContainText('VALIDATION_FAILED');
 await expect(page.getByTestId('calibration-screen')).toContainText('No revision produced');
 await expect(badge).toHaveAttribute('data-level','assumed');
 // another plant's record: refused with its reason, none of its values
 await page.locator('#twin-import-calibration').setInputFiles(file(record({configDigest:d('e')})));
 await expect(page.getByTestId('calibration-error')).toContainText('CONFIG_DIGEST_MISMATCH');await expect(page.getByTestId('calibration-screen')).not.toContainText('armatureKgM2');
 await expect(badge).toHaveAttribute('data-level','assumed');
 // a tool self-test is labelled, never measured
 await page.locator('#twin-import-calibration').setInputFiles(file(record({configDigest:wheel,sourceKind:'synthetic',toolSelfTest:true,reasonCodes:['SYNTHETIC_DATA','TOOL_SELF_TEST']})));
 await expect(page.getByTestId('calibration-record')).toHaveAttribute('data-label','self_test');await expect(page.getByTestId('calibration-label')).toContainText('Tool self-test');
 await expect(badge).toHaveAttribute('data-level','assumed');
 // a record edited after it was written (same digest, another value) is refused
 await page.locator('#twin-import-calibration').setInputFiles(file({...record({configDigest:wheel}),fitted:[{path:'armatureKgM2[2]',value:99,atBound:false,unit:'kg*m^2',standardError:0.001}]}));
 await expect(page.getByTestId('calibration-error')).toContainText('CALIBRATION_FILE_INVALID');
 // a file that is not a record, a record claiming acceptance
 await page.locator('#twin-import-calibration').setInputFiles(file({...record({configDigest:wheel}),accepted:true}));
 await expect(page.getByTestId('calibration-error')).toContainText('CALIBRATION_FILE_INVALID');
 // three languages
 await page.getByRole('button',{name:'VI',exact:true}).click();await expect(page.getByTestId('control-model-maturity')).toContainText('Mức model');
 await page.getByRole('button',{name:'JA',exact:true}).click();await expect(page.getByTestId('control-model-maturity')).toContainText('モデルの成熟度');
 await sweepWeb07(page,{panel:'calibration',testId:'control-model-maturity',reopen:()=>openInspector(page,'control')});
 expect(errors).toEqual([]);
});
