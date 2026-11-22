// V10 (R4 §7.4/7.5): the three-cup tray on the pinned runtime with the real MuJoCo worker: choose a variant, run A' then B, read the design hint (or why there is none) in the compare panel.
// One spec per launcher (one-use pairing code):
//   node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-tray.spec.ts
import {test,expect,type Page,type Request} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
import {sweepWeb07} from '../support/web07';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,dir=process.env.LAB_IRSIM_SCREENSHOTS;
const shot=async(p:Page,name:string)=>{if(dir)await p.screenshot({path:`${dir}/V10-${name}.png`,fullPage:true});};
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());

async function runVariant(page:Page,variant:string){
 await page.getByTestId('tray-experiment').selectOption(variant);
 await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:180000});
 const created=page.waitForResponse(r=>isCreate(r.request()));await page.locator('[data-action="twin-run"]').first().click();
 const response=await created;expect(response.status()).toBe(201);
 const body=response.request().postDataJSON();expect(body).toMatchObject({scenarioId:'MJ-TRAY01',backendSetId:'engineering-mujoco-3d-v1'});expect(body.engineeringRef).toBeTruthy();expect(body.project?.faultSchedule).toBeUndefined();
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:60000});
 await page.locator('#twin-run-speed').selectOption('64');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.getByTestId('run-status')).toContainText(/Completed|Needs attention/,{timeout:420000});
}

test('tray: five registered variants, A-prime then B, and a design hint or the reason there is none, in three languages',async({page})=>{
 test.setTimeout(1200000);page.setDefaultTimeout(30000);
 expect(token,'Run through scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile mujoco-tray.spec.ts').toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-tray"]').click();await openInspector(page,'setup');
 // the runtime offers all five registered variants; the drive experiment is implied by the variant, shown and not chosen
 const select=page.getByTestId('tray-experiment');await expect(select).toBeVisible();
 await expect(select.locator('option')).toHaveCount(5);for(const o of await select.locator('option').all())await expect(o).toBeEnabled();
 await expect(page.getByTestId('drive-experiment-fixed')).toContainText('drive-nominal-v1');
 await select.selectOption('tray-torque-limited-v1');await expect(page.getByTestId('drive-experiment-fixed')).toContainText('drive-torque-limited-v1');
 await shot(page,'variants');
 // A-prime, then B: the compare panel holds the previous run beside this one
 await runVariant(page,'tray-low-friction-v1');
 await runVariant(page,'tray-accel-high-v1');
 await openInspector(page,'report');
 const hint=page.getByTestId('tray-hint');await expect(hint).toBeVisible({timeout:60000});await shot(page,'hint');
 const available=await hint.getAttribute('data-available');
 if(available==='true'){await expect(hint).toContainText('physical test');await expect(hint).toContainText('acceleration limit');await expect(hint).not.toContainText(/optimal|p95/i);}
 else{await expect(hint).toContainText('Not enough data to compare');}
 for(const [lang,word] of available==='true'?[['JA','物理試験'],['VI','thử nghiệm vật lý']] as const:[['JA','比較に十分なデータがありません'],['VI','Không đủ dữ liệu để so sánh']] as const){await page.getByRole('button',{name:lang,exact:true}).click();await expect(page.getByTestId('tray-hint')).toContainText(word);}
 await sweepWeb07(page,{panel:'tray',testId:'tray-hint'});
 expect(errors).toEqual([]);
});
