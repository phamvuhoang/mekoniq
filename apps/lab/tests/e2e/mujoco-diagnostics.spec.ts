// R5.4 Diagnostics (DGN02, DGN04) on the pinned runtime with the real MuJoCo mobile worker. One spec per launcher (one-use pairing code):
//   node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-diagnostics.spec.ts
// A drive trip on the left wheel gives the run a drive fault; the panel is opened and driven by keyboard, a wheel is picked by mouse in the 2D twin,
// an alarm jumps to its tick and the twin marks the wheel with an outline and an icon (2D: SVG; 3D: a box and an icon sprite, named on the canvas).
import {test,expect,type Page} from '@playwright/test';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL,dir=process.env.LAB_IRSIM_SCREENSHOTS;
const shot=async(p:Page,name:string)=>{if(dir)await p.screenshot({path:`${dir}/DGN-${name}.png`,fullPage:true});};
const view=async(page:Page,v:'2d'|'3d')=>{await openDisplayMenu(page);await page.locator(`[data-action="twin-view"][data-value="${v}"]`).click();if(await page.getByTestId('display-menu').isVisible())await page.locator('[data-action="twin-display-toggle"]').click();};

test('diagnostics: keyboard and mouse open the right axis, an alarm jumps to its tick and the twin marks the wheel with an outline and an icon',async({page})=>{
 test.setTimeout(600000);page.setDefaultTimeout(30000);
 expect(token,'Run through scripts/test-irsim-e2e.mjs --provider mujoco --mujoco-mobile mujoco-diagnostics.spec.ts').toBeTruthy();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-payload"]').click();await openInspector(page,'setup');
 const studio=page.getByTestId('drive-faults');await expect(studio).toBeVisible();
 if(!await studio.evaluate((d:HTMLDetailsElement)=>d.open))await studio.locator('summary').click();
 await page.getByTestId('drive-experiment').selectOption('drive-nominal-v1');
 await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:180000});
 await page.locator('#twin-df-fault').selectOption('drive-trip');await page.locator('#twin-df-target').selectOption('amr-1/wheel-left');await page.locator('#twin-df-at').fill('8000');
 await studio.locator('[data-action="twin-drivefault-add"]').click();await expect(studio.locator('.fault-timeline-list li')).toHaveCount(1);
 const created=page.waitForResponse(r=>r.request().method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url()));await page.locator('[data-action="twin-run"]').first().click();expect((await created).status()).toBe(201);
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:60000});
 await page.locator('#twin-run-speed').selectOption('16');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.getByTestId('run-status')).toContainText(/Needs attention|Completed|Failed/,{timeout:240000});
 await openInspector(page,'report');await expect(page.getByTestId('fault-evidence')).toBeVisible({timeout:60000});

 // DGN02 keyboard: the Diagnostics tab by Enter on its tab, the axis from the listbox by arrows
 const tab=page.getByTestId('inspector-tab-diagnostics');await tab.focus();await page.keyboard.press('Enter');
 await expect(page.getByTestId('diagnostics')).toBeVisible();
 const list=page.locator('#twin-diag-target');await expect(list.locator('option')).toContainText(['amr-1/wheel-left','amr-1/wheel-right']);
 await list.focus();while(await list.inputValue()!=='amr-1/wheel-left')await page.keyboard.press('ArrowDown');
 await expect(page.locator('#diag-title')).toContainText('amr-1/wheel-left');
 const tags=page.getByTestId('diag-tags');
 await expect(tags.locator('tr[data-tag="state"]')).toHaveAttribute('data-quality',/good|stale/);
 await expect(tags.locator('tr[data-tag="io"]')).toHaveAttribute('data-quality','unavailable');   // the run report has no I/O stream yet: "no data", never a 0
 const alarm=page.getByTestId('diag-alarms').locator('li').first();await expect(alarm).toBeVisible();await expect(alarm.locator('[aria-hidden="true"]')).toHaveText('⚠');
 const jump=alarm.locator('[data-action="twin-fault-jump"]'),tick=Number(await jump.getAttribute('data-value'));expect(tick).toBeGreaterThan(0);
 await expect(tags.locator('tr[data-tag="fault"]')).not.toHaveText(/—\s*$/);
 await shot(page,'panel');

 // DGN04: Enter on the alarm puts the replay cursor on its tick; the 2D twin marks the robot (outline + icon) and the wheel, not by colour alone
 await jump.focus();await page.keyboard.press('Enter');
 await expect(page.locator('#twin-replay-cursor')).toHaveValue(String(tick),{timeout:60000});
 await view(page,'2d');
 const mark=page.locator('[data-alarm-entity="amr-1"]');await expect(mark).toBeVisible();
 await expect(mark.locator('.tw-alarm-ring')).toHaveCount(1);await expect(mark.locator('.tw-alarm-icon')).toHaveCount(1);await expect(mark).toHaveAttribute('aria-label',/Alarm/);
 await expect(page.locator('.tw-wheel[data-axis="amr-1/wheel-left"]')).toHaveAttribute('data-alarm','true');await expect(page.locator('.tw-wheel[data-axis="amr-1/wheel-right"]')).toHaveAttribute('data-alarm','false');
 expect(await mark.evaluate(e=>e.getAnimations({subtree:true}).length),'no motion on the mark').toBe(0);
 await shot(page,'2d-mark');
 // before the alarm (one cursor step back): no mark
 await page.locator('#twin-replay-cursor').fill(String(Math.max(0,tick-5)));
 await expect(page.locator('[data-alarm-entity="amr-1"]')).toHaveCount(0);await expect(page.locator('.tw-wheel[data-axis="amr-1/wheel-left"]')).toHaveAttribute('data-alarm','false');
 // 3D: the same marks, as an outline box and an icon sprite; the canvas names what it marks
 await openInspector(page,'diagnostics');await jump.click();await expect(page.locator('#twin-replay-cursor')).toHaveValue(String(tick));
 await view(page,'3d');await expect(page.locator('#twin-stage canvas')).toHaveAttribute('data-alarm-marks',/amr-1\/wheel-left/,{timeout:30000});
 await shot(page,'3d-mark');

 // DGN02 mouse: the right wheel picked in the 2D twin opens Diagnostics on it
 await view(page,'2d');await openInspector(page,'objects');
 await page.locator('.tw-wheel[data-axis="amr-1/wheel-right"] rect').click();
 await expect(page.getByTestId('inspector-tab-diagnostics')).toHaveAttribute('aria-selected','true');await expect(page.locator('#diag-title')).toContainText('amr-1/wheel-right');
 // and by keyboard on the twin: Enter on the left wheel
 await page.locator('.tw-wheel[data-axis="amr-1/wheel-left"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#diag-title')).toContainText('amr-1/wheel-left');
 for(const [lang,word] of [['JA','診断'],['VI','Chẩn đoán'],['EN','Diagnostics']] as const){await page.getByRole('button',{name:lang,exact:true}).click();await expect(page.locator('#diag-title')).toContainText(word);}
 expect(errors).toEqual([]);
});
