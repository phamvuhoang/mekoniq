// V09 (R4 §7.3): the drive fault studio on the pinned runtime with the real MuJoCo worker. One spec per launcher (one-use pairing code):
//   node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-faults.spec.ts
import {test,expect,type Page,type Request} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
import {sweepWeb07} from '../support/web07';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,dir=process.env.LAB_IRSIM_SCREENSHOTS;
const shot=async(p:Page,name:string)=>{if(dir)await p.screenshot({path:`${dir}/V09-${name}.png`,fullPage:true});};
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());
const isValidate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/projects\/validate$/.test(r.url());

test('drive fault studio: compose, check (and a refused overlap that creates no run), narrow list, run, read the report, jump to the applied tick',async({page})=>{
 test.setTimeout(600000);page.setDefaultTimeout(30000);
 expect(token,'Run through scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile mujoco-faults.spec.ts').toBeTruthy();
 const errors:string[]=[],creates:Request[]=[],validates:Request[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(isCreate(r))creates.push(r);if(isValidate(r))validates.push(r);});
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-payload"]').click();await openInspector(page,'setup');
 const studio=page.getByTestId('drive-faults');await expect(studio).toBeVisible();
 if(!await studio.evaluate((d:HTMLDetailsElement)=>d.open))await studio.locator('summary').click();
 // a schedule without a drive experiment cannot be checked or run (the run would have no drive); choosing one lifts that
 await page.locator('#twin-df-fault').selectOption('motor-weak');await expect(page.locator('#twin-df-p-torqueScale')).toBeVisible();   // a fault with its own parameter: the new defaults, not the previous fault's fields
 await studio.locator('[data-action="twin-drivefault-add"]').click();await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);await expect(studio.locator('.fault-timeline-list li')).toContainText('torqueScale');
 await expect(page.getByTestId('drive-fault-check-button')).toBeDisabled();await expect(page.getByTestId('drive-fault-message')).toContainText('FAULT_BACKEND_UNSUPPORTED');await expect(page.locator('[data-action="twin-run"]').first()).toBeDisabled();
 await studio.locator('[data-action="twin-drivefault-clear"]').click();await expect(studio.locator('.fault-timeline-list li')).toHaveCount(0);
 // the runtime offers the catalog; the drive experiment is the run's, chosen here (the mobile run's lives in its engineering project)
 await page.getByTestId('drive-experiment').selectOption('drive-nominal-v1');
 await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:180000});
 // compose: only faults with a target on this preset are offered, targets by kind, parameters inside the advertised bounds
 const fault=page.locator('#twin-df-fault');
 const offered=await fault.locator('option').allTextContents();expect(offered).toEqual(expect.arrayContaining(['encoder-dropout','command-delay','motor-weak','drive-trip','command-loss','lidar-noise']));expect(offered).not.toContain('grip-weak');expect(offered).not.toContain('drive-reset');
 await fault.selectOption('encoder-dropout');
 await expect(page.locator('#twin-df-target option')).toHaveText(['amr-1/wheel-left','amr-1/wheel-right']);
 await page.locator('#twin-df-target').selectOption('amr-1/wheel-right');await page.locator('#twin-df-at').fill('12000');await page.locator('#twin-df-p-durationMs').fill('300');
 await studio.locator('[data-action="twin-drivefault-add"]').click();
 await expect(studio.locator('[data-lane="feedback"] rect')).toHaveCount(1);await expect(studio.locator('.fault-timeline-list li')).toContainText('encoder-dropout · amr-1/wheel-right');
 await shot(page,'composed');
 // an out-of-bounds duration never becomes an entry
 await page.locator('#twin-df-p-durationMs').fill('10');await studio.locator('[data-action="twin-drivefault-add"]').click();
 await expect(page.getByTestId('drive-fault-message')).toContainText('FAULT_PARAM_INVALID');await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);
 // check: the runtime is asked, no run is created
 await studio.getByTestId('drive-fault-check-button').click();
 await expect(page.getByTestId('drive-fault-check')).toHaveAttribute('data-state','ok');
 expect(validates.length).toBe(1);expect(validates[0]!.postDataJSON()).toMatchObject({scenarioId:'MJ-FD01',backendSetId:'engineering-mujoco-3d-v1',driveFaultSchedule:[{faultId:'encoder-dropout',targetId:'amr-1/wheel-right',durationMs:300}]});expect(creates.length).toBe(0);
 // two entries that overlap on one wheel: the runtime refuses with its code, per entry kind, and still no run
 await page.locator('#twin-df-p-durationMs').fill('300');await page.locator('#twin-df-at').fill('12100');await studio.locator('[data-action="twin-drivefault-add"]').click();
 await expect(studio.locator('.fault-timeline-list li')).toHaveCount(2);
 await expect(page.getByTestId('drive-fault-check')).toHaveAttribute('data-state','idle');   // the verdict was for one entry, not for this schedule
 await studio.getByTestId('drive-fault-check-button').click();
 await expect(page.getByTestId('drive-fault-check')).toHaveAttribute('data-state','refused');await expect(page.getByTestId('drive-fault-check')).toContainText('FAULT_OVERLAP');
 expect(creates.length).toBe(0);
 // narrow screen: the plot gives way to the list, which still names every entry, also when the window is resized while the timeline is showing
 await page.setViewportSize({width:390,height:844});
 await expect(studio.locator('.fault-timeline-plot')).toBeHidden();await expect(studio.locator('.fault-timeline-list li')).toHaveCount(2);await expect(studio.locator('.fault-timeline-list')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await shot(page,'390-list');
 await page.setViewportSize({width:1440,height:900});await expect(studio.locator('.fault-timeline-plot')).toBeVisible();
 // remove the second entry; the check passes again
 await studio.locator('.fault-timeline-list li').nth(1).locator('[data-action="twin-drivefault-remove"]').click();
 await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);await studio.getByTestId('drive-fault-check-button').click();await expect(page.getByTestId('drive-fault-check')).toHaveAttribute('data-state','ok');
 // the schedule file: export, and a file that is not a schedule is refused whole
 const download=page.waitForEvent('download');await studio.locator('[data-action="twin-drivefault-export"]').click();
 const file=await download,text=await (await import('node:fs/promises')).readFile((await file.path())!,'utf8');expect(JSON.parse(text)).toMatchObject({documentType:'drive-fault-schedule',entries:[{faultId:'encoder-dropout'}]});
 await page.locator('#twin-drivefault-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"schemaVersion":1,"documentType":"lab-project"}')});
 await expect(page.getByTestId('drive-fault-message')).toContainText('SCHEDULE_FILE_INVALID');await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);
 // run it
 const created=page.waitForResponse(r=>isCreate(r.request()));await page.locator('[data-action="twin-run"]').first().click();const createdResponse=await created;
 const body=createdResponse.request().postDataJSON();expect(body.driveFaultSchedule).toHaveLength(1);expect(body.driveFaultSchedule[0]).toMatchObject({faultId:'encoder-dropout',targetId:'amr-1/wheel-right',trigger:{kind:'elapsed_sim_ms',value:12000},durationMs:300});
 expect(body.project?.faultSchedule).toBeUndefined();expect(body.engineeringRef).toBeTruthy();   // never in the project; the experiment is in the compiled engineering project
 expect(createdResponse.status()).toBe(201);
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:60000});
 await page.locator('#twin-run-speed').selectOption('16');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.getByTestId('run-status')).toContainText('Needs attention',{timeout:180000});
 // the report: the fault row, detected by the drive in time
 await openInspector(page,'report');
 const section=page.getByTestId('fault-evidence');await expect(section).toBeVisible({timeout:60000});
 const row=section.locator('tr[data-verdict]').first();await expect(row).toHaveAttribute('data-verdict','detected_in_time');await expect(row).toContainText('FEEDBACK_LOSS');await expect(row).toContainText('tick 601');await expect(row).toContainText('4/6 pass · 2 n/a');await expect(row).not.toContainText('violated');   // custody and the timeout torque do not apply to a trip-free mobile run
 await shot(page,'report');
 // a click on the row puts the replay cursor on the tick the fault was applied
 await row.locator('[data-action="twin-fault-jump"]').click();
 await expect(page.locator('#twin-replay-cursor')).toHaveValue('601',{timeout:60000});
 for(const [lang,word] of [['JA','期限内に検出'],['VI','Phát hiện đúng hạn'],['EN','Detected in time']] as const){await page.getByRole('button',{name:lang,exact:true}).click();await expect(page.getByTestId('fault-evidence')).toContainText(word);}
 await sweepWeb07(page,{panel:'faults',testId:'fault-evidence'});
 expect(errors).toEqual([]);
});
