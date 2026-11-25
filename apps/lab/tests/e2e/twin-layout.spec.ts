import {test,expect,type Page} from '@playwright/test';
import {openDisplayMenu,openInspector,openProblems,openScenarioPicker} from '../support/twin';
// U01: the twin page is three fixed regions (run bar, viewport, transport bar) plus a details inspector closed by default. Against the mock
// launcher (scripts/test-mock-e2e.mjs twin-layout.spec.ts), preset coffee (BV01).
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/U01-${name}.png`});};
const LEVEL1=['scenario-picker','runtime-chip','mode-badge','run-status','run-tick','run-served','twin-scene','twin-transport'];
// where every existing data-testid now lives (spec §6.3); `ids` are element ids
const ROWS:{name:string;open:(page:Page)=>Promise<void>;container:string;testids:string[];ids?:string[]}[]=[
 {name:'display',open:openDisplayMenu,container:'[data-testid="display-menu"]',testids:['twin-legend','honesty-notes','layer-provenance','layers-2d-only','navigation-scene-unavailable']},
 {name:'objects',open:p=>openInspector(p,'objects'),container:'#inspector-panel-objects',testids:['cycle-queue','entity-list','cup-owner']},
 {name:'problems',open:openProblems,container:'[data-testid="problems-panel"]',testids:['attention-reason']},
 {name:'engineering',open:p=>openInspector(p,'engineering'),container:'#inspector-panel-engineering',testids:['twin-telemetry','run-identity','run-id','run-revision','engineering-panel'],ids:['twin-fault']},
 {name:'report',open:p=>openInspector(p,'report'),container:'#inspector-panel-report',testids:['report-streams','saved-evidence','controller-verification'],ids:['twin-report-summary','twin-import-evidence']},
 {name:'setup',open:p=>openInspector(p,'setup'),container:'#inspector-panel-setup',testids:['preflight'],ids:['twin-backend-set','twin-fault-schedule','twin-speed-limit']},
];
const sel=(id:string)=>`[data-testid="${id}"]`;
/** Every instance of the row's items sits in its container; those present are visible once it is open. Conditional items (IR-SIM layers,
 * attention, …) may be absent on a mock run, but never anywhere else. */
async function rowReachable(page:Page,row:typeof ROWS[number]){
 await row.open(page);
 for(const s of [...row.testids.map(sel),...(row.ids??[]).map(i=>`#${i}`)]){
  const all=page.locator(s),inside=page.locator(row.container).locator(s),n=await all.count();
  expect(await inside.count(),`${row.name}: ${s} lives in ${row.container}`).toBe(n);
  for(let i=0;i<n;i++)await expect(inside.nth(i),`${row.name}: ${s}`).toBeVisible();
 }
}
const noVerticalScroll=(page:Page)=>page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight);
const sceneShare=(page:Page)=>page.evaluate(()=>{const r=document.querySelector('[data-testid="twin-scene"]')!.getBoundingClientRect();return r.width*r.height/(innerWidth*innerHeight);});
const inWindow=(page:Page,testid:string)=>page.evaluate(id=>{const r=document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&r.height>0;},testid);
/** The transport is on top at its own centre: nothing (the open inspector sheet) covers it. */
const uncovered=(page:Page,testid:string)=>page.evaluate(id=>{const t=document.querySelector(`[data-testid="${id}"]`)!,r=t.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&t.contains(hit);},testid);

test.describe.serial('viewport-first twin layout',()=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs twin-layout.spec.ts: it starts the pinned source runtime and supplies its one-time token.');
 test.describe.configure({timeout:180000});
 let page:Page;
 test.beforeAll(async({browser})=>{
  page=await browser.newPage({viewport:{width:1440,height:900}});
  // counts the page's own animation frames (Playwright's actionability checks run in another world)
  await page.addInitScript(()=>{const w=window as unknown as {rafCalls:number},raf=window.requestAnimationFrame.bind(window);w.rafCalls=0;window.requestAnimationFrame=cb=>{w.rafCalls++;return raf(cb);};});
 });
 test.afterAll(async()=>{await page.close();});

 test('first open: level 1 only, the inspector closed, no vertical scroll and a dominant viewport',async()=>{
  await page.goto('/#twin');
  await expect(page.getByTestId('twin-transport')).toBeVisible();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  for(const id of LEVEL1)await expect(page.getByTestId(id),id).toBeVisible();
  await expect(page.getByTestId('problems-count')).toBeVisible();// not paired: preflight fails
  for(const row of ROWS)for(const s of [...row.testids.map(sel),...(row.ids??[]).map(i=>`#${i}`)])await expect(page.locator(s).first(),`${row.name}: ${s}`).toBeHidden();
  // not paired: the runtime box is open with the pairing form
  await expect(page.getByTestId('runtime-popover')).toBeVisible();
  for(const s of ['#twin-pair-form','#twin-pair-token'])await expect(page.getByTestId('runtime-popover').locator(s)).toBeVisible();
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.6);
  await shot(page,'first-open-desktop-vi');
  // U02: one problem (not paired); its row names it, carries a reason code and leads to the runtime box
  await expect(page.getByTestId('problems-count')).toContainText('1');
  await expect(page.getByTestId('mode-badge')).toContainText('Mô phỏng · chưa chạy');
  await openProblems(page);
  await expect(page.getByTestId('runtime-popover')).toBeHidden();// one run-bar box at a time
  const row=page.getByTestId('problems-panel').getByTestId('problem-row');
  await expect(row).toHaveCount(1);await expect(row).toContainText('ghép nối');await expect(row.locator('code')).not.toHaveCount(0);
  await row.locator('[data-action="twin-runtime-toggle"]').click();
  await expect(page.getByTestId('runtime-popover')).toBeVisible();await expect(page.getByTestId('problems-panel')).toBeHidden();
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.6);
  await rowReachable(page,ROWS.find(r=>r.name==='setup')!);
  await shot(page,'setup-desktop-vi');// preflight is shown until a run starts
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.45);
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
 });

 test('every relocated item is reachable from its container during a run',async()=>{
  // the press on Details above closed the runtime box (a press outside an open box closes it): open it again
  if(!await page.getByTestId('runtime-popover').isVisible())await page.getByTestId('runtime-chip').click();
  await page.locator('#twin-pair-token').fill(token!);
  await page.getByRole('button',{name:'Ghép nối runtime'}).click();
  await expect(page.getByTestId('runtime-popover')).toBeHidden();
  await openScenarioPicker(page);
  await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
  await expect(page.locator('#twin-picker')).toBeHidden();
  await expect(page.getByTestId('primary-action')).toHaveText('Chạy mock');
  await expect(page.getByTestId('next-action')).toBeVisible();
  await page.getByTestId('primary-action').click();
  await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
  for(const s of ['twin-scene','twin-fallback-note','next-action'].map(sel))expect(await page.locator('.twin-viewport').locator(s).count(),s).toBe(await page.locator(s).count());
  for(const row of ROWS.filter(r=>r.name!=='setup'&&r.name!=='problems')){await rowReachable(page,row);await shot(page,`${row.name}-desktop-vi`);}
  // the app-wide honesty notes the twin page no longer shows in a footer/strip live in the Display menu
  await openDisplayMenu(page);
  await expect(page.getByTestId('honesty-notes')).toContainText('Mô hình minh họa · chưa nghiệm thu phần cứng');
  await expect(page.getByTestId('honesty-notes')).toContainText('Source runtime · chỉ mô phỏng nghiệp vụ');
  await page.getByTestId('runtime-chip').click();
  await expect(page.getByTestId('runtime-popover')).toBeVisible();
  await page.getByTestId('runtime-chip').click();
  await expect(page.getByTestId('runtime-popover')).toBeHidden();
 });

 test('3D (U04): the scene is kept while samples play; camera home and fit; a layer from the Display menu; reduced motion has no animation loop',async()=>{
  const canvas=page.getByTestId('twin-scene').locator('canvas'),tick=page.getByTestId('run-tick'),transport=page.getByTestId('twin-transport');
  let start:(()=>Promise<void>)|undefined;
  const rafs=()=>page.evaluate(()=>(window as unknown as {rafCalls:number}).rafCalls),attr=async(n:string)=>(await canvas.getAttribute(n))!;
  const auto=async(ms:number,watch?:()=>Promise<void>,settle=0)=>{
   await transport.getByRole('button',{name:'Tự chạy',exact:true}).click();await page.waitForTimeout(settle);await start?.();
   const until=Date.now()+ms;while(Date.now()<until){await watch?.();await page.waitForTimeout(200);}
   await transport.getByRole('button',{name:'Tạm dừng tự chạy'}).click();
   await expect(transport.getByRole('button',{name:'Tự chạy',exact:true})).toBeEnabled({timeout:30000});
  };
  await expect(canvas).toHaveAttribute('data-camera',/^-?\d+\.\d{3},/);
  // 4×: the 8 s of auto-run below must not finish the ~100 s run (a paced 16× run now keeps real 16× and would)
  await page.locator('#twin-run-speed').selectOption('4');
  // 5 s of auto-run: the tick moves on every sample batch and the scene is not rebuilt for it; only a change of the set of objects (a new cup) rebuilds it
  const objects=()=>page.locator('#twin-entity-list [data-action="twin-select"]').evaluateAll(b=>b.map(x=>(x as HTMLElement).dataset.value).join());
  let r0=0,o0=0,before=0;const ticks=new Set<string|null>(),sets=new Set<string>();
  start=async()=>{r0=Number(await attr('data-rebuilds'));o0=Number(await attr('data-overlay-builds'));before=await rafs();sets.add(await objects());};
  await auto(5000,async()=>{ticks.add(await tick.textContent());sets.add(await objects());},1000);start=undefined;
  const rebuilt=Number(await attr('data-rebuilds'))-r0;
  expect(rebuilt,'rebuilt only when the set of objects changed').toBeLessThanOrEqual(sets.size-1);
  expect(ticks.size,'the tick moved many times without a rebuild').toBeGreaterThan(rebuilt+5);
  const rafN=await rafs()-before,overlays=Number(await attr('data-overlay-builds'))-o0;
  expect(rafN,'live samples are played on animation frames').toBeGreaterThan(0);
  // an animation frame changes transforms only: the overlays (path, footprint) are not rebuilt per frame
  expect(overlays,`overlay builds ${overlays} over ${rafN} animation frames`).toBeLessThan(rafN/4);
  // camera: orbit away, home brings it back; fit (key f, nothing selected) frames the whole scene
  const home=await attr('data-camera'),box=(await canvas.boundingBox())!,[cx,cy]=[box.x+box.width/2,box.y+box.height/2];
  await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+140,cy+40,{steps:6});await page.mouse.up();
  await expect(canvas).not.toHaveAttribute('data-camera',home);
  await page.getByRole('button',{name:'Về góc nhìn gốc'}).click();
  await expect(canvas).toHaveAttribute('data-camera',home);
  await page.keyboard.press('f');
  await expect(canvas).not.toHaveAttribute('data-camera',home);
  await page.getByRole('button',{name:'Về góc nhìn gốc'}).click();
  // the Display menu turns a layer on and off: that is a structural change
  await openDisplayMenu(page);
  const frames=page.getByTestId('display-menu').locator('[data-action="twin-layer"][data-value="frames"]'),r1=Number(await attr('data-rebuilds'));
  await frames.click();await expect(frames).toHaveAttribute('aria-pressed','true');
  await expect.poll(async()=>Number(await attr('data-rebuilds'))).toBeGreaterThan(r1);
  await frames.click();await expect(frames).toHaveAttribute('aria-pressed','false');
  await page.locator('[data-action="twin-display-toggle"]').click();
  // reduced motion: no animation loop, the view is still redrawn per sample
  await page.emulateMedia({reducedMotion:'reduce'});
  const still=await canvas.screenshot(),f0=await rafs();
  await auto(3000);
  expect(await rafs(),'no animation frame with reduced motion').toBe(f0);
  expect((await canvas.screenshot()).equals(still),'the view follows the samples').toBe(false);
  await page.emulateMedia({reducedMotion:'no-preference'});
 });

 test('a re-render keeps the scroll position of an inspector tab',async()=>{
  await openInspector(page,'objects');
  await page.getByTestId('entity-list').getByRole('button',{name:/Cánh tay 1/}).click();
  await openInspector(page,'engineering');
  const panel=page.locator('#inspector-panel-engineering');
  expect(await panel.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(60);
  const before=await panel.evaluate(el=>{el.scrollTop=60;return el.scrollTop;});
  const tick=await page.getByTestId('run-tick').textContent();
  await page.getByRole('button',{name:'+5 s'}).click();
  await expect(page.getByTestId('run-tick')).not.toHaveText(tick!);
  expect(Math.abs(await panel.evaluate(el=>el.scrollTop)-before)).toBeLessThanOrEqual(1);
 });

 test('a completed run still fits the window with the inspector closed and on every tab',async()=>{
  // the 3D test's auto-run (about 9 s at 16×) can already have finished the 100 s run on a fast machine: Auto-run is then disabled
  if(!(await page.getByTestId('run-status').innerText()).includes('Hoàn thành')){
   await page.locator('#twin-run-speed').selectOption('64');
   await page.getByTestId('twin-transport').getByRole('button',{name:'Tự chạy',exact:true}).click();
  }
  await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:150000});
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  expect(await noVerticalScroll(page)).toBe(true);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.6);
  for(const tab of ['objects','engineering','report','setup'] as const){
   await openInspector(page,tab);
   expect(await noVerticalScroll(page),tab).toBe(true);
   expect(await sceneShare(page),tab).toBeGreaterThanOrEqual(0.45);
   await shot(page,`completed-${tab}-desktop-vi`);
  }
 });

 test('a fault: the problem count grows, the row leads to its object, the strip shows in the viewport; the label explains itself',async()=>{
  const count=page.getByTestId('problems-count'),before=await count.count()?Number(/\d+/.exec(await count.textContent()??'')?.[0]??0):0;
  await page.getByTestId('primary-action').click();// run again with the same inputs: a new run, started
  await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
  await openInspector(page,'engineering');
  await page.locator('#twin-fault').selectOption('cup-removed');
  await page.getByRole('button',{name:'Chèn lỗi'}).click();
  await expect(page.getByTestId('run-status')).toContainText('Cần kiểm tra');
  await expect(count).toBeVisible();
  expect(Number(/\d+/.exec(await count.textContent()??'')?.[0])).toBeGreaterThan(before);
  await rowReachable(page,ROWS.find(r=>r.name==='problems')!);
  const first=page.getByTestId('problems-panel').getByTestId('problem-row').first();
  await expect(first).toContainText('CUP_REMOVED');
  await expect(first.locator('[data-action="twin-select"]')).toHaveText(['coffee-job-1','cup-1']);// one card: its attention chain carries the object buttons (job, then its cup)
  await expect(page.locator('.twin-viewport').getByTestId('next-action')).toBeVisible();
  await shot(page,'problems-desktop-vi');
  await first.locator('[data-action="twin-select"]').first().click();
  await expect(page.getByTestId('inspector-title')).toContainText('coffee-job-1');
  await expect(page.getByTestId('problems-panel')).toBeHidden();// following a problem to its object closes the box
  // the label is a button: its box names the mode with the access word, the shared notes and the report's limitations
  await expect(page.getByTestId('mode-badge')).toContainText('Mô phỏng · MOCK');
  await page.getByTestId('mode-badge').click();
  const caveat=page.getByTestId('caveat-detail');
  await expect(caveat).toBeVisible();await expect(page.getByTestId('problems-panel')).toBeHidden();
  await expect(caveat).toContainText('MOCK · simulated');
  await expect(caveat).toContainText('Mô hình minh họa · chưa nghiệm thu phần cứng');
  await expect(caveat.getByTestId('caveat-limitations').locator('li')).not.toHaveCount(0);
  await shot(page,'caveat-desktop-vi');
  // the picker: runnable presets first; a Webots preset this mock runtime cannot run stays listed, disabled, with its reason
  await openScenarioPicker(page);
  await expect(caveat).toBeHidden();
  const buttons=page.locator('#twin-picker [data-action="twin-preset"]'),states=await buttons.evaluateAll(b=>b.map(x=>(x as HTMLButtonElement).disabled));
  expect(states.indexOf(true)).toBeGreaterThan(0);expect(states.slice(states.indexOf(true)).every(Boolean)).toBe(true);
  const webots=page.locator('#twin-picker [data-action="twin-preset"][data-value="webots-coffee"]');
  await expect(webots).toBeDisabled();
  await expect(webots.getByTestId('picker-reasons')).toContainText(/[A-Z_]{6,}/);
  expect(await sceneShare(page)).toBeGreaterThanOrEqual(0.45);
  await shot(page,'picker-desktop-vi');
  await page.getByTestId('scenario-picker').click();
  await expect(page.locator('#twin-picker')).toBeHidden();
 });

 test('the chosen tab survives a reload',async()=>{
  await openInspector(page,'engineering');
  await page.reload();
  await expect(page.getByTestId('twin-inspector')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-engineering')).toHaveAttribute('aria-selected','true');
  await expect(page.locator('#inspector-panel-engineering')).toBeVisible();
 });

 test('phone: the transport stays in view and the inspector sheet never covers it',async()=>{
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  expect(await inWindow(page,'twin-transport')).toBe(true);
  await openInspector(page,'objects');
  expect(await inWindow(page,'twin-transport')).toBe(true);
  expect(await uncovered(page,'twin-transport')).toBe(true);
  await shot(page,'objects-phone-vi');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 });

 test('low screen: the page scrolls and the transport sticks to the bottom',async()=>{
  await page.setViewportSize({width:1280,height:640});
  await page.locator('[data-action="twin-inspector-toggle"]').click();
  await expect(page.getByTestId('twin-inspector')).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollHeight>innerHeight)).toBe(true);
  expect(await inWindow(page,'twin-transport')).toBe(true);
  await shot(page,'low-screen');
  await page.evaluate(()=>scrollTo(0,0));
  expect(await inWindow(page,'twin-transport')).toBe(true);
 });
});
