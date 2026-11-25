// V09 / WEB10: records the `drive-fault` sample on the real MuJoCo cell: a drive-trip on the right wheel while the AMR carries the first cup, then the Lab's own "Export replay" button.
// Not part of the regression set: it needs LAB_FAULT_SAMPLE_DIR and writes replay-<run>.zip there. Launch:
//   LAB_FAULT_SAMPLE_DIR=/some/dir node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-fault-sample.spec.ts
import {test,expect,type Request} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,out=process.env.LAB_FAULT_SAMPLE_DIR;
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());
test('record the drive-fault sample: drive-trip on the right wheel while the AMR carries the cup, exported with the Lab button',async({page})=>{
 test.skip(!out,'Set LAB_FAULT_SAMPLE_DIR to record the sample');test.setTimeout(900000);page.setDefaultTimeout(60000);
 expect(token).toBeTruthy();await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-cell"]').click();await openInspector(page,'setup');
 const studio=page.getByTestId('drive-faults');if(!await studio.evaluate((d:HTMLDetailsElement)=>d.open))await studio.locator('summary').click();
 await page.getByTestId('drive-experiment').selectOption('drive-nominal-v1');
 await page.locator('#twin-df-fault').selectOption('drive-trip');await page.locator('#twin-df-target').selectOption('amr-1/wheel-right');await page.locator('#twin-df-at').fill('48000');
 await studio.locator('[data-action="twin-drivefault-add"]').click();await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);
 await studio.getByTestId('drive-fault-check-button').click();await expect(page.getByTestId('drive-fault-check')).toHaveAttribute('data-state','ok');
 await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:120000});
 const created=page.waitForResponse(r=>isCreate(r.request()));await page.locator('[data-action="twin-run"]').first().click();const response=await created;expect(response.status()).toBe(201);
 const runId=(await response.json()).run.id as string;
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:120000});
 await page.locator('#twin-run-speed').selectOption('16');await page.locator('[data-action="twin-play"]').first().click();
 // the trip is at tick 2401; the recording stops a few hundred ticks later: long enough to see the AMR stop, short enough to export (a held cell would run on to a pickup timeout at tick 9400)
 await expect(page.locator('#twin-transport-time')).toContainText(/tick 2[5-6]\d\d/,{timeout:600000});
 await page.locator('[data-action="twin-stop"]').first().click();await expect(page.locator('[data-action="twin-cancel"]').first()).toBeEnabled({timeout:60000});
 await expect(page.getByTestId('run-status')).toContainText('Running');   // stopped auto-run, not cancelled: a held cell keeps its Source state, and the export is an immutable prefix of the live run
 await openInspector(page,'report');if(await page.locator('[data-action="twin-report-reload"]').count())await page.locator('[data-action="twin-report-reload"]').first().click();
 const row=page.getByTestId('fault-evidence').locator('tr[data-verdict]').first();
 await expect(row).toHaveAttribute('data-verdict','detected_in_time',{timeout:120000});await expect(row).toContainText('drive-trip');
 const download=page.waitForEvent('download',{timeout:300000});await page.locator('[data-action="twin-world-export"]').first().click();
 const zip=await download;await zip.saveAs(join(out!,`replay-${runId}.zip`));writeFileSync(join(out!,'run.json'),JSON.stringify({runId}));
});
