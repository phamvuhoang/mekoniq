import {test,expect,type Page} from '@playwright/test';
import {barLayout,openInspector,openScenarioPicker,WIDTHS} from '../support/twin';
// I3: the run bar never clips the scenario or the label and never overflows: it wraps onto a second row. I4: at phone width the transport's icon-only
// controls are told apart by their icons and named. I5: the chip's word in the states a mock run reaches. On real pixels, against the mock launcher:
// node scripts/test-mock-e2e.mjs twin-runbar-layout.spec.ts. The MuJoCo run (simulation label, one note) is asserted in mujoco-coffee.spec.ts with the same `barLayout`.
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/final-${name}.png`});};
async function eachWidth(page:Page,state:string){
 for(const [w,h] of WIDTHS){
  await page.setViewportSize({width:w,height:h});await page.waitForTimeout(150);
  expect(await barLayout(page),`${state} ${w}`).toEqual({oneLine:true,twelve:true,label:true,overlaps:[],inside:true,noScroll:true,title:true});
  await shot(page,`I3-${state}-${w}x${h}`);
 }
 await page.setViewportSize({width:1440,height:900});
}
test.use({actionTimeout:15000});
const chip=(page:Page)=>page.getByTestId('runtime-chip');

test('run bar layout in every state at three widths; the transport at phone width; the runtime chip\'s words',async({page})=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs twin-runbar-layout.spec.ts: it starts the pinned source runtime and supplies its one-time token.');
 test.setTimeout(240000);
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/#twin');
 await expect(chip(page)).toHaveAttribute('data-state','none');await shot(page,'I5-chip-not-paired');
 // a loopback address nothing listens on: the attempt failed, so the chip says so (never green), and the box is cause-neutral
 await page.locator('#twin-runtime-url').fill('http://127.0.0.1:4179');await page.locator('#twin-pair-token').fill('not-used');await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-error')).toContainText('Không tới được runtime trên máy này');
 await expect(chip(page)).toHaveAttribute('data-state','failed');await expect(chip(page)).toContainText('Không kết nối được');await shot(page,'I5-chip-failed-box');
 await page.locator('label',{hasText:'Máy này'}).click();
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await expect(chip(page)).toHaveAttribute('data-state','live');await expect(chip(page)).toContainText('Sẵn sàng');await shot(page,'I5-chip-ready');
 // item 11: a press outside an open box closes it; a press inside it, or on the button that opened it, is not outside
 await openScenarioPicker(page);{const b=(await page.locator('#twin-picker').boundingBox())!;await page.mouse.click(b.x+3,b.y+3);}await expect(page.locator('#twin-picker')).toBeVisible();
 {const b=(await page.locator('#twin-stage').boundingBox())!;await page.mouse.click(b.x+b.width-30,b.y+b.height-30);}// a real press on the viewport (the open box lies over its top)await expect(page.locator('#twin-picker')).toBeHidden();
 await page.getByTestId('mode-badge').click();await expect(page.getByTestId('caveat-detail')).toBeVisible();
 await page.getByTestId('scenario-picker').click();await expect(page.getByTestId('caveat-detail')).toBeHidden();await expect(page.locator('#twin-picker')).toBeVisible();// another box's button: this one opens, that one closes
 await page.getByTestId('scenario-picker').click();await expect(page.locator('#twin-picker')).toBeHidden();
 await openScenarioPicker(page);await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
 await eachWidth(page,'before-run');
 await page.getByTestId('primary-action').click();
 await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
 await expect(chip(page)).toContainText('Trực tiếp');await shot(page,'I5-chip-live');
 await eachWidth(page,'running');

 // I4: auto-running at 390 px: Stop auto-run, Pause and Cancel are three different icons, each named
 await page.setViewportSize({width:390,height:844});
 await page.locator('#twin-run-speed').selectOption('1');
 await page.locator('#twin-transport [data-action="twin-play"]').click();
 await expect(page.locator('#twin-transport [data-action="twin-stop"]')).toBeVisible();
 const controls=await page.evaluate(()=>['twin-stop','twin-pause','twin-cancel'].map(a=>{const b=document.querySelector(`#twin-transport [data-action="${a}"]`) as HTMLButtonElement;
  const label=b.querySelector('span')!;return {a,svg:b.querySelector('svg')!.innerHTML,name:(b.getAttribute('aria-label')??b.textContent??'').trim(),title:b.title,labelHidden:label.getBoundingClientRect().width<=1};}));
 expect(new Set(controls.map(c=>c.svg)).size).toBe(3);
 for(const c of controls){expect(c.name,c.a).not.toBe('');expect(c.title,c.a).toBe(c.name);expect(c.labelHidden,c.a).toBe(true);}
 await shot(page,'I4-transport-390-running');
 await page.locator('#twin-transport [data-action="twin-stop"]').click();
 await expect(page.locator('#twin-transport [data-action="twin-play"]')).toBeVisible();
 await page.setViewportSize({width:1440,height:900});

 // item 4: the run's report cannot be fetched (the request fails): the Report tab says so and offers one Reload report
 await page.route('**/lab/v2/runs/*/report',r=>r.abort());
 await page.locator('#twin-run-speed').selectOption('64');
 await page.locator('#twin-transport [data-action="twin-play"]').click();
 await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:180000});
 await openInspector(page,'report');await expect(page.getByTestId('report-missing')).toBeVisible();await shot(page,'item4-report-reload');
 await page.unroute('**/lab/v2/runs/*/report');await page.locator('[data-action="twin-report-reload"]').click();
 await expect(page.getByTestId('report-panel')).toBeVisible();await expect(page.getByTestId('report-missing')).toHaveCount(0);
 await page.locator('[data-action="twin-inspector-toggle"]').click();
 await expect(page.getByTestId('primary-action')).toHaveText('Chạy lại cùng đầu vào');
 await eachWidth(page,'completed');
});
