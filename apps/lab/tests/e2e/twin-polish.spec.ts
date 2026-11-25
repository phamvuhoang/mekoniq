import {test,expect,type Page} from '@playwright/test';
import {openInspector,openProblems,openScenarioPicker} from '../support/twin';
// U07: what the screenshots showed wrong on the twin page. Against the mock launcher (scripts/test-mock-e2e.mjs twin-polish.spec.ts), preset coffee (BV01).
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/U07-${name}.png`});};
const WORDS=['Chưa ghép nối','Chưa kết nối','Đang kết nối','Không kết nối được','Khác phiên bản','Trực tiếp','Chậm','Mất kết nối','Bản ghi','Sẵn sàng'];
const blur=(page:Page)=>page.evaluate(()=>(document.activeElement as HTMLElement|null)?.blur());
/** The chip's visible text: one word, no transport name, reason code or seconds. */
async function chipWord(page:Page){
 const text=((await page.getByTestId('runtime-chip').textContent())??'').replace('Runtime:','').trim();
 expect(WORDS,text).toContain(text);expect(text).not.toMatch(/SSE|[A-Z_]{4,}|\d\s*s\b/);
 return text;
}
const fits=(page:Page,selector:string)=>page.locator(selector).evaluate(el=>el.scrollWidth<=el.clientWidth);
const noVerticalScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight);
const sceneShare=(page:Page)=>page.evaluate(()=>{const r=document.querySelector('[data-testid="twin-scene"]')!.getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight);});
const runBarHeight=(page:Page)=>page.locator('#twin-run-bar').evaluate(el=>el.getBoundingClientRect().height);

test.describe.serial('twin page polish',()=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs twin-polish.spec.ts: it starts the pinned source runtime and supplies its one-time token.');
 test.describe.configure({timeout:180000});
 let page:Page;
 test.beforeAll(async({browser})=>{page=await browser.newPage({viewport:{width:1440,height:900}});});
 test.afterAll(async()=>{await page.close();});

 test('a notice is shown in the banner, not counted; an emptied problems box does not reopen by itself',async()=>{
  await page.goto('/#twin');
  await expect(page.getByTestId('runtime-chip')).toHaveAttribute('data-state','none');
  expect(await chipWord(page)).toBe('Chưa ghép nối');
  await openScenarioPicker(page);
  await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
  await page.locator('#twin-pair-token').fill(token!);
  await openProblems(page);// the box is open when the list empties
  await expect(page.getByTestId('problems-count')).toContainText('1');
  await page.locator('#twin-pair-form').evaluate(f=>(f as HTMLFormElement).requestSubmit());
  await expect(page.locator('.twin-viewport .notice')).toContainText('đã ghép nối');
  await expect(page.getByTestId('problems-count')).toHaveCount(0);
  await expect(page.getByTestId('problems-panel')).toBeHidden();
  expect(await chipWord(page)).toBe('Sẵn sàng');
 });

 test('running: a plain runtime word on the bar, the telemetry detail in the Engineering tab and the runtime box, repainted live',async()=>{
  await page.getByTestId('primary-action').click();
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
  // not auto-running, samples age between steps (the mock arm has no encoder): the word describes the link, which is live
  await expect.poll(()=>chipWord(page),{timeout:5000}).toBe('Trực tiếp');
  await expect(page.getByTestId('runtime-chip')).toHaveAttribute('data-state','live');
  await expect(page.locator('#twin-run-bar [data-testid="twin-telemetry"]')).toHaveCount(0);
  await expect(page.getByTestId('twin-telemetry')).toHaveCount(1);
  await openInspector(page,'engineering');
  const detail=page.locator('#inspector-panel-engineering').getByTestId('twin-telemetry');
  await expect(detail).toBeVisible();await expect(detail).toContainText('SSE');
  await expect(detail).toHaveText(/^SSE · \S+ (mới|cũ|chưa rõ|FROZEN_SIM)/);// the detail keeps the sample's freshness (and age, reason)
  const before=await detail.textContent();
  await expect.poll(()=>detail.textContent(),{timeout:5000}).not.toBe(before);// the 100 ms repaint (sample age)
 });

 test('Engineering tab with the arm selected: one block per quantity, nothing wider than the panel',async()=>{
  await openInspector(page,'objects');
  await page.getByTestId('entity-list').getByRole('button',{name:/Cánh tay 1/}).click();
  await openInspector(page,'engineering');
  const panel=page.locator('#inspector-panel-engineering');
  await expect(panel.locator('[data-testid^="eng-"]').first()).toBeVisible();
  expect(await fits(page,'#inspector-panel-engineering')).toBe(true);
  const over=await panel.evaluate(p=>{const right=p.getBoundingClientRect().right;return [...p.querySelectorAll('[data-testid^="eng-"],[data-testid^="eng-"] *')].filter(el=>el.getBoundingClientRect().right>right+0.5).map(el=>el.outerHTML.slice(0,80));});
  expect(over).toEqual([]);
  await shot(page,'engineering-arm-desktop-vi');
 });

 test('Objects tab: the current cup line keeps its distance from the job cards',async()=>{
  await openInspector(page,'objects');
  const gap=await page.evaluate(()=>{const q=document.querySelector('#inspector-panel-objects [data-testid="cycle-queue"]')!.getBoundingClientRect(),c=document.querySelector('#inspector-panel-objects [data-testid="cup-owner"]')!.closest('p')!.getBoundingClientRect();return c.top-q.bottom;});
  expect(gap).toBeGreaterThanOrEqual(8);
 });

 test('one attention problem: one card holding its chain, object buttons by name; the box stays closed; the scenario name is not cut',async()=>{
  await openInspector(page,'engineering');
  await page.locator('#twin-fault').selectOption('cup-removed');
  await page.getByRole('button',{name:'Chèn lỗi'}).click();
  await expect(page.getByTestId('run-status')).toContainText('Cần kiểm tra');
  await expect(page.getByTestId('problems-count')).toBeVisible();
  await expect(page.getByTestId('problems-panel')).toBeHidden();// not reopened by the new problem
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('primary-action')).toBeVisible();
  await expect(page.locator('#twin-scenario-value')).toHaveText('Cà phê sữa đá');
  expect(await fits(page,'#twin-scenario-value')).toBe(true);
  await shot(page,'run-bar-problem-desktop-vi');
  await openProblems(page);
  const cards=page.getByTestId('problems-panel').locator('[data-testid="problem-row"][data-severity="attention"]');
  await expect(cards).toHaveCount(1);
  await expect(page.getByTestId('attention-reason')).toHaveCount(1);
  await expect(cards.getByTestId('attention-reason')).toHaveCount(1);
  await expect(cards.getByTestId('attention-reason')).toContainText('CUP_REMOVED');
  const buttons=cards.locator('[data-action="twin-select"]');
  expect(await buttons.count()).toBeGreaterThan(0);
  for(const b of await buttons.all()){const name=((await b.textContent())??'').trim();expect(name.length).toBeGreaterThan(0);expect(await b.getAttribute('aria-label')).toContain(name);}
  await expect(buttons).toHaveText(['coffee-job-1','cup-1']);
  await shot(page,'problems-desktop-vi');
  await page.getByTestId('problems-count').click();
  await expect(page.getByTestId('problems-panel')).toBeHidden();
 });

 test('the runtime box repeats the telemetry detail, repainted live',async()=>{
  await page.getByTestId('runtime-chip').click();
  const copy=page.getByTestId('runtime-popover').locator('#twin-telemetry-box');
  await expect(copy).toBeVisible();await expect(copy).toContainText('SSE');
  const was=await copy.textContent();
  await expect.poll(()=>copy.textContent(),{timeout:5000}).not.toBe(was);
  await page.getByTestId('runtime-chip').click();
  await expect(page.getByTestId('runtime-popover')).toBeHidden();
 });

 test('scenario picker: a preset that cannot run gives one reason per backend',async()=>{
  await openScenarioPicker(page);
  const lists=await page.locator('#twin-picker [data-action="twin-preset"]:disabled [data-testid="picker-reasons"]').evaluateAll(ls=>ls.map(l=>[...l.querySelectorAll('code')].map(c=>c.textContent??'')));
  expect(lists.length).toBeGreaterThan(0);
  for(const codes of lists){const backends=codes.filter(c=>c.startsWith('BACKEND_')).map(c=>c.split(':')[1]!.split(' ')[0]);expect(new Set(backends).size,codes.join()).toBe(backends.length);}
  await page.getByTestId('scenario-picker').click();
  await expect(page.locator('#twin-picker')).toBeHidden();
 });

 test('toolbar buttons expose their state; ? moves focus into the key list and back; one twin-help button; the label explains itself in watch mode',async()=>{
  const help=page.locator('[data-action="twin-help"]'),watch=page.locator('[data-action="twin-watch"]'),list=page.getByTestId('shortcuts');
  await expect(help).toHaveCount(1);
  await expect(help).toHaveAttribute('aria-expanded','false');await expect(watch).toHaveAttribute('aria-pressed','false');
  await watch.focus();await page.keyboard.press('?');
  await expect(list).toBeVisible();
  await expect(list.getByRole('button',{name:'Đóng'})).toBeFocused();
  await expect(help).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(watch).toBeFocused();
  await help.click();
  await expect(list.getByRole('button',{name:'Đóng'})).toBeFocused();
  await list.getByRole('button',{name:'Đóng'}).click();
  await expect(list).toBeHidden();await expect(help).toBeFocused();
  await expect(help).toHaveCount(1);
  await blur(page);await page.keyboard.press('w');
  await expect(watch).toHaveAttribute('aria-pressed','true');
  await page.getByTestId('mode-badge').click();
  await expect(page.getByTestId('caveat-detail')).toBeVisible();
  await blur(page);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await expect(page.getByTestId('caveat-detail')).toBeHidden();
  await expect(watch).toHaveAttribute('aria-pressed','false');
 });

 test('replay: no live action on the run bar, a recorded tag, no run speed; Space on the scrubber plays, a held Space toggles once',async()=>{
  await openInspector(page,'report');
  await page.getByRole('button',{name:'Xem lại (chỉ đọc)'}).click();
  await expect(page.getByTestId('primary-action')).toHaveCount(0);
  await expect(page.getByTestId('recorded-tag')).toBeVisible();
  await expect(page.getByTestId('run-status')).not.toContainText('Bản ghi');// the recorded status itself, the tag beside it
  expect(await page.evaluate(()=>document.querySelector('[data-testid="recorded-tag"]')!.parentElement===document.querySelector('[data-testid="run-status"]')!.parentElement)).toBe(true);
  await expect(page.locator('#twin-run-speed')).toHaveCount(0);
  expect(await chipWord(page)).toBe('Bản ghi');
  const transport=page.getByTestId('twin-transport'),cursor=page.locator('#twin-replay-cursor');
  await cursor.fill('0');
  await cursor.focus();await page.keyboard.press(' ');
  await expect(transport.getByRole('button',{name:'Dừng phát'})).toBeVisible();
  // playing: one press stops it; the auto-repeat of the held key does not start it again
  await page.keyboard.down(' ');await page.keyboard.down(' ');await page.keyboard.up(' ');
  await expect(transport.getByRole('button',{name:'Phát',exact:true})).toBeVisible();
  const at=await page.getByTestId('replay-time').textContent();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('replay-time')).toHaveText(at!);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.45);
  await shot(page,'replay-desktop-vi');
  await transport.getByRole('button',{name:'Thoát xem lại'}).click();
  await expect(page.getByTestId('recorded-tag')).toHaveCount(0);
  await expect(page.getByTestId('primary-action')).toBeVisible();
 });

 test('1024 × 700: no vertical scroll and the run bar keeps its one row',async()=>{
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  const wide=await runBarHeight(page);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.6);
  await page.setViewportSize({width:1024,height:700});
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await runBarHeight(page)).toBe(wide);
  expect(await page.getByTestId('mode-badge').evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(46);
  // the narrow-width tightening of the label is in effect (not overridden by the base rule)
  const [spacing,...padding]=await page.getByTestId('mode-badge').evaluate(el=>{const s=getComputedStyle(el);return [s.letterSpacing,s.paddingLeft,s.paddingRight];});
  expect(['normal','0px'],`letter-spacing ${spacing} (the base rule gives .06em = 0.72px)`).toContain(spacing);// Chrome reports 0 as "normal"
  expect(padding).toEqual(['8px','8px']);// the base rule gives 10px
  await shot(page,'1024x700-vi');
 });
});
