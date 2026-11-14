import {test,expect,type Page} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
// U03: one transport bar for a live run and for replay, keyboard control and a watch mode. Against the mock launcher
// (scripts/test-mock-e2e.mjs twin-transport.spec.ts), preset coffee (BV01).
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/U03-${name}.png`});};
/** Keys go to the page, not to a focused button (Space on a button keeps its native meaning). */
const blur=(page:Page)=>page.evaluate(()=>(document.activeElement as HTMLElement|null)?.blur());
const press=async(page:Page,key:string)=>{await blur(page);await page.keyboard.press(key);};
const transport=(page:Page)=>page.getByTestId('twin-transport');
/** Every disabled transport button looks disabled: dimmed, no pointer cursor. */
async function dimmed(page:Page){
 const styles=await page.locator('#twin-transport button:disabled').evaluateAll(bs=>bs.map(b=>{const s=getComputedStyle(b);return {opacity:Number(s.opacity),cursor:s.cursor};}));
 expect(styles.length).toBeGreaterThan(0);
 for(const s of styles){expect(s.opacity).toBeLessThan(1);expect(s.cursor).not.toBe('pointer');}
}
const noVerticalScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight);

for(const viewport of [{width:390,height:844},{width:1024,height:768}])test(`watch mode can be exited by touch at ${viewport.width}px without a keyboard`,async({browser})=>{
 const context=await browser.newContext({viewport,hasTouch:true}),page=await context.newPage();
 try{
  await page.goto('/#twin');
  if(await page.getByTestId('runtime-popover').isVisible())await page.getByTestId('runtime-chip').tap();
  await page.getByRole('button',{name:'Chế độ xem',exact:true}).tap();
  await expect(page.locator('.twin-shell')).toHaveClass(/watch/);
  const exit=page.getByRole('button',{name:'Thoát chế độ xem',exact:true});
  await expect(exit).toBeVisible();await expect(exit).toHaveAttribute('aria-pressed','true');
  await expect.poll(()=>exit.evaluate(e=>{const r=e.getBoundingClientRect();return Math.min(r.width,r.height);})).toBeGreaterThanOrEqual(44);
  await exit.tap();
  await expect(page.locator('.twin-shell')).not.toHaveClass(/watch/);
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByTestId('scenario-picker')).toBeVisible();
  await expect(page.getByRole('button',{name:'Chế độ xem',exact:true})).toHaveAttribute('aria-pressed','false');
 }finally{await context.close();}
});

test.describe.serial('transport bar, keys and watch mode',()=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs twin-transport.spec.ts: it starts the pinned source runtime and supplies its one-time token.');
 test.describe.configure({timeout:180000});
 let page:Page;
 test.beforeAll(async({browser})=>{page=await browser.newPage({viewport:{width:1440,height:900}});});
 test.afterAll(async()=>{await page.close();});

 test('no run: keys typed in the pairing code stay there; disabled buttons look disabled',async()=>{
  await page.goto('/#twin');
  await expect(transport(page)).toBeVisible();
  await dimmed(page);
  const code=page.locator('#twin-pair-token');
  await code.focus();await page.keyboard.type('wi?');
  await expect(code).toHaveValue('wi?');
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  await expect(page.getByTestId('shortcuts')).toBeHidden();
  await code.fill(token!);
  await page.getByRole('button',{name:'Ghép nối runtime'}).click();
  await expect(page.getByTestId('runtime-popover')).toBeHidden();
  await openScenarioPicker(page);
  await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
  await page.getByTestId('primary-action').click();
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
 });

 test('live run: → steps, Space starts and stops auto-run, ? lists the keys',async()=>{
  const tick=await page.getByTestId('run-tick').textContent();
  await press(page,'ArrowRight');
  await expect(page.getByTestId('run-tick')).not.toHaveText(tick!);
  await press(page,' ');
  await expect(transport(page).locator('[data-action="twin-stop"]')).toBeVisible();
  await press(page,' ');
  await expect(transport(page).locator('[data-action="twin-play"]')).toBeVisible();
  await press(page,'?');
  const help=page.getByTestId('shortcuts');
  await expect(help).toBeVisible();
  for(const k of ['Space','→','F','I','W','?','Esc'])await expect(help.locator('kbd',{hasText:k}).first()).toBeVisible();
  await shot(page,'shortcuts-desktop-vi');
  await press(page,'Escape');
  await expect(help).toBeHidden();
 });

 test('watch mode: only the viewport, three labels and the transport; Escape gives everything back one step at a time',async()=>{
  await openInspector(page,'objects');
  await press(page,'w');
  for(const s of ['.topbar','.sidebar','[data-testid="scenario-picker"]','[data-testid="runtime-chip"]','[data-testid="run-served"]','[data-testid="primary-action"]','[data-action="twin-inspector-toggle"]','[data-testid="twin-inspector"]','[data-action="twin-display-toggle"]'])await expect(page.locator(s).first(),s).toBeHidden();
  for(const id of ['twin-scene','mode-badge','run-status','run-tick','twin-transport'])await expect(page.getByTestId(id),id).toBeVisible();
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await page.evaluate(()=>{const r=document.querySelector('[data-testid="twin-scene"]')!.getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight);})).toBeGreaterThanOrEqual(0.75);
  await shot(page,'watch-desktop');
  // the transport stays usable in watch mode
  const tick=await page.getByTestId('run-tick').textContent();
  await transport(page).getByRole('button',{name:'+5 s'}).click();
  await expect(page.getByTestId('run-tick')).not.toHaveText(tick!);
  await press(page,'Escape');
  for(const s of ['.topbar','.sidebar','[data-testid="scenario-picker"]','[data-testid="twin-inspector"]'])await expect(page.locator(s),s).toBeVisible();
  await press(page,'Escape');
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  await press(page,'i');
  await expect(page.getByTestId('twin-inspector')).toBeVisible();
  await press(page,'i');
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  // leaving the page removes the listener: no key acts elsewhere, and back on the page each key acts once
  await page.goto('/#design');await expect(page.locator('.twin-shell')).toHaveCount(0);
  await press(page,'w');await expect(page.locator('.topbar')).toBeVisible();
  await page.goto('/#twin');await expect(transport(page)).toBeVisible();
  await press(page,'i');
  await expect(page.getByTestId('twin-inspector')).toBeVisible();
  await press(page,'i');
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
 });

 test('replay: the transport turns into a scrubber with marks; dragging moves the time, Space plays and stops',async()=>{
  await page.locator('#twin-run-speed').selectOption('64');
  await press(page,' ');
  await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:150000});
  await dimmed(page);
  const done=await page.getByTestId('run-tick').textContent();
  await openInspector(page,'report');
  await page.getByRole('button',{name:'Xem lại (chỉ đọc)'}).click();
  const cursor=transport(page).locator('#twin-replay-cursor');
  await expect(cursor).toBeVisible();
  await expect(page.locator('input[type="range"]')).toHaveCount(1);
  await expect(cursor).toHaveAttribute('list','twin-replay-marks');
  expect(await page.locator('#twin-replay-marks option').count()).toBeGreaterThan(0);
  // the replay controls live in the transport only
  for(const a of ['twin-replay-play','twin-replay-exit'])await expect(page.locator(`#inspector-panel-report [data-action="${a}"]`),a).toHaveCount(0);
  await expect(page.getByTestId('replay-panel')).toContainText('Chỉ đọc');
  await dimmed(page);
  // one row at 1440 px with the inspector open: the scrubber shares it, the viewport keeps its share
  expect(await transport(page).evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(60);
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await page.evaluate(()=>{const r=document.querySelector('[data-testid="twin-scene"]')!.getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight);})).toBeGreaterThanOrEqual(0.45);
  await cursor.fill('0');
  await expect(page.getByTestId('run-tick')).not.toHaveText(done!);
  await expect(page.getByTestId('replay-time')).toContainText('tick 0');
  await shot(page,'replay-desktop-vi');
  await press(page,' ');
  await expect(transport(page).getByRole('button',{name:'Dừng phát'})).toBeVisible();
  await press(page,' ');
  await expect(transport(page).getByRole('button',{name:'Phát',exact:true})).toBeVisible();
  const at=await page.getByTestId('replay-time').textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('replay-time')).toHaveText(at!);// stopped
  await transport(page).getByRole('button',{name:'Thoát xem lại'}).click();
  await expect(cursor).toHaveCount(0);
  await expect(page.getByTestId('run-tick')).toHaveText(done!);
 });
 test('Escape closes the modal confirm dialog (its native cancel), and the dialog opens again',async()=>{
  await page.getByTestId('primary-action').click();// run again with the same inputs
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
  await openInspector(page,'engineering');
  await page.locator('#twin-fault').selectOption('cup-removed');
  await page.getByRole('button',{name:'Chèn lỗi'}).click();
  await expect(page.getByTestId('run-status')).toContainText('Cần kiểm tra');
  await expect(page.getByTestId('primary-action')).toHaveText('Đối soát');
  const confirm=page.locator('#twin-confirm');
  await page.getByTestId('primary-action').click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(page.getByTestId('twin-inspector')).toBeVisible();// the Escape went to the dialog, not to the page's own steps
  await page.getByTestId('primary-action').click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button',{name:'Hủy'}).click();
  await expect(confirm).toHaveCount(0);
 });
});
