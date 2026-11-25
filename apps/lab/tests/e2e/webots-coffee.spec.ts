// WB-BV01 against the real pinned runtime and the real Webots R2025a (scripts/test-irsim-e2e.mjs --provider webots tests/e2e/webots-coffee.spec.ts): open the preset, run to completed,
// see the arm's actual and commanded joints apart and the arm drawn as a joint chain in 3D, read the plant block (not_calibrated) in the report.
// Without the launcher's pairing code this FAILS (it is never skipped). The screenshot is candidate evidence only, never backend evidence.
import {test,expect,type Page} from '@playwright/test';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_IRSIM_SCREENSHOTS;
const runId=async(page:Page)=>(await page.getByTestId('run-id').textContent())!.trim();
interface Report {outcome:{status:string;served:string};manifest:{scenario:{id:string};mode:string;backends:{id:string}[]};limitations:string[];
 arm?:{armPlant:{engine:string;control:string;grip:string;calibration:string};collision:{result:string};trace:{samples:number};tracking:{samples:number}}}
const report=async(page:Page)=>{const id=await runId(page);return page.evaluate(async r=>(await fetch(`/lab/v2/runs/${r}/report`,{credentials:'same-origin'})).json(),id) as Promise<Report>;};

test('coffee with the arm on Webots: run to completed, actual and commanded joints, the joint chain in 3D, and the plant block in the report',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider webots tests/e2e/webots-coffee.spec.ts: it starts lab:webots with the real Webots and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(900000);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 // the arm set is offered because health says webots_arm is live and advertises sim3d_arm_v1
 await expect(page.locator('#twin-backend-set option[value="engineering-webots-arm-v1"]')).toBeEnabled();

 await openScenarioPicker(page);await page.getByRole('button',{name:'Webots · coffee with a 3D arm'}).click();
 // polled with its text: a readiness that never becomes ok fails with the runtime's own reasons
 await expect.poll(async()=>{const li=page.getByTestId('preflight').locator('li',{hasText:'Runtime readiness'});return await li.getAttribute('class')==='ok'?'ok':await li.innerText();},{timeout:180000,intervals:[1000]}).toBe('ok');
 await page.getByRole('button',{name:'Run Webots (arm)'}).click();
 await expect(page.getByTestId('mode-badge')).toHaveText('Simulation · not calibrated');/* the page is in English here */await expect(page.getByTestId('mode-badge')).toHaveAttribute('data-mode','simulation');
 await expect(page.getByTestId('run-identity')).toContainText('WB-BV01');

 // a step, then the arm: each joint block has two values (observed, commanded), the source row says which is which
 await page.getByRole('button',{name:'+5 s'}).click();
 await openInspector(page,'objects');await page.getByTestId('entity-list').getByRole('button',{name:/Arm-1/}).click();
 const q1=page.getByTestId('eng-joint-1');
 await expect(q1.locator('dd').nth(0)).toContainText(/-?\d/);await expect(q1.locator('dd').nth(1)).toContainText(/-?\d/);
 await expect(page.getByTestId('eng-arm-source')).toContainText('actual (Webots) · commanded');
 await expect(page.getByTestId('eng-joint-1')).not.toContainText('no encoder');

 // 3D: the arm is a chain of links and joints now, not one cylinder
 await openDisplayMenu(page);await page.getByRole('button',{name:'3D',exact:true}).click();
 await expect(page.locator('canvas[aria-label^="3D twin view"]')).toBeVisible();
 await page.locator('#twin-run-speed').selectOption('64');
 await page.getByRole('button',{name:'Auto-run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:600000});

 const r=await report(page);
 expect(r.manifest).toMatchObject({scenario:{id:'WB-BV01'},mode:'simulation'});expect(r.manifest.backends.map(b=>b.id).sort()).toEqual(['mock_amr','mock_coffee','webots_arm']);
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 expect(r.arm).toMatchObject({armPlant:{engine:'webots_3d',control:'position_servo',grip:'event',calibration:'not_calibrated'},collision:{result:'pass'}});
 expect(r.arm!.trace.samples).toBeGreaterThan(300);
 const block=page.getByTestId('arm-plant');
 await expect(block).toContainText('not_calibrated');await expect(block).toContainText('position_servo');await expect(block).toContainText('ARM03: pass');
 if(shots)await page.screenshot({path:`${shots}/webots-coffee.png`,fullPage:true});
 await context.close();
});
