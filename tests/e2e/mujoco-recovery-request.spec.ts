import {test,expect} from '@playwright/test';
import {join} from 'node:path';
import {openInspector,openScenarioPicker} from '../support/twin';

test('the advertised two-stage cup experiment creates a new belief run on the default drive',async({page})=>{
 test.setTimeout(420000);
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(process.env.LAB_TEST_RUNTIME_URL)await page.locator('#twin-runtime-url').fill(process.env.LAB_TEST_RUNTIME_URL);
 await page.locator('#twin-pair-token').fill(process.env.LAB_TEST_PAIRING_TOKEN!);
 await page.locator('#twin-pair-form button[type="submit"]').click();await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-cell"]').click();await openInspector(page,'setup');
 const program=page.locator('#twin-grasp-program'),experiment=page.locator('#twin-world-experiment'),nudge='world-cup-nudge-v2',twoStage='cup-pick-two-stage-v1';
 await expect(program).toBeDisabled();await expect(experiment.locator('option[value="'+nudge+'"]')).toBeDisabled();
 await page.locator('#twin-grasp-mode-belief_ground_truth').check();await program.selectOption(twoStage);await experiment.selectOption(nudge);
 await page.locator('#twin-grasp-mode-fixed_program').check();await expect(program).toHaveValue('');await expect(experiment).toHaveValue('world-nominal-v1');
 await page.locator('#twin-grasp-mode-belief_estimated').check();await program.selectOption(twoStage);await experiment.selectOption(nudge);
 await page.emulateMedia({reducedMotion:'reduce'});
 for(const [lang,title] of [['VI','Gắp cốc hai giai đoạn'],['JA','2段階のカップ把持'],['EN','Two-stage cup grasp']]){
  await page.getByRole('button',{name:lang,exact:true}).click();await openInspector(page,'setup');await expect(program.locator('option:checked')).toHaveText(title!);
  await page.setViewportSize({width:390,height:844});await openInspector(page,'setup');await expect(experiment).toHaveValue(nudge);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
  if(process.env.LAB_IRSIM_SCREENSHOTS)await page.screenshot({path:join(process.env.LAB_IRSIM_SCREENSHOTS,'recovery-setup-'+lang+'.png')});
  await page.setViewportSize({width:1440,height:900});
 }
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url()));
 await page.locator('[data-action="twin-run"]').first().click();const response=await created;expect(response.status()).toBe(201);
 const body=response.request().postDataJSON();expect(body).toMatchObject({scenarioId:'MJ-CELL-BV01',graspMode:'belief_estimated',graspProgramId:twoStage,worldExperimentId:nudge,perceptionProfileId:'perception-nominal-v1',recoveryPolicyId:'pick-recovery-v1'});expect(body).not.toHaveProperty('driveExperimentId');
 await openInspector(page,'setup');await expect(program).toBeDisabled();await expect(experiment).toBeDisabled();
 await page.locator('#twin-run-speed').selectOption('64');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.locator('#twin-transport-time')).toContainText(/tick (19\d\d|[2-9]\d{3})/,{timeout:250000});
 await page.locator('[data-action="twin-stop"]').first().click();await openInspector(page,'report');
 if(await page.locator('[data-action="twin-report-reload"]').count())await page.locator('[data-action="twin-report-reload"]').first().click();
 const table=page.getByTestId('perception-attempts');
 await expect(table.locator('[data-attempt="cup-1#0"] [data-outcome]')).toHaveAttribute('data-outcome','grip_not_established',{timeout:30000});
 await expect(table.locator('[data-attempt="cup-1#1"] [data-outcome]')).toHaveAttribute('data-outcome','lifted');
 await expect(page.getByTestId('perception-recovery').locator('li[data-result="done"]')).toHaveCount(4);
 if(process.env.LAB_IRSIM_SCREENSHOTS)await page.screenshot({path:join(process.env.LAB_IRSIM_SCREENSHOTS,'live-recovery.png')});
});
