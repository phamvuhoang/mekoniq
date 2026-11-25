import {test,expect,type Page,type Request} from '@playwright/test';
import {openDisplayMenu,openScenarioPicker} from '../support/twin';
// N03 / RT04: the Lab on another origin (http://localhost:4177, no /lab of its own) reaches the runtime at http://127.0.0.1:4176 with a bearer
// session and fetch-based streams. Run with scripts/test-mock-e2e.mjs remote-origin.spec.ts: the launcher starts the runtime with
// --allow-origin http://localhost:4177 and serves the Lab again on --extra-ui-port 4177. One spec per launcher (one-use pairing code).
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const LAB=`http://localhost:${process.env.LAB_TEST_EXTRA_PORT??4177}`,RUNTIME=`http://127.0.0.1:${process.env.LAB_TEST_RUNTIME_PORT??4176}`;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/N03-${name}.png`});};
const PAGES=['design','assembly','restaurant','scenarios','results','deployment','twin'];

test('a Lab on another origin sends nothing to the runtime before the click, then pairs with a bearer and runs BV01 to completed',async({page})=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs remote-origin.spec.ts: it starts the pinned runtime for this origin and supplies its one-time token.');
 test.setTimeout(180000);
 await page.setViewportSize({width:1440,height:900});
 const toRuntime:Request[]=[];page.on('request',r=>{if(r.url().startsWith(RUNTIME))toRuntime.push(r);});
 await page.goto(`${LAB}/#twin`);
 const address=page.locator('#twin-runtime-url');
 await expect(address).toBeVisible();await expect(address).toHaveValue('');
 // the page's own origin has no runtime: the automatic probe (own origin only) finds none, and nothing went to 127.0.0.1:4176
 await expect(page.getByTestId('runtime-popover')).toContainText('Không thấy runtime /lab/v2');
 await page.waitForTimeout(1500);
 expect(toRuntime.map(r=>r.url())).toEqual([]);
 await shot(page,'before-connect');

 // an http address that is not loopback is refused next to the field, before any request
 await address.fill('http://rt.example:4176');await page.locator('#twin-pair-token').fill('not-a-code');
 await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-address-error')).toContainText('Địa chỉ không hợp lệ');
 await expect(address).toHaveAttribute('aria-invalid','true');
 await shot(page,'address-error');
 expect(toRuntime).toHaveLength(0);
 // typing a different value removes the error at once (before any submit), keeping focus in the field
 await address.focus();await address.press('ControlOrMeta+a');await address.pressSequentially(RUNTIME);
 await expect(page.getByTestId('runtime-address-error')).toHaveCount(0);await expect(address).not.toHaveAttribute('aria-invalid','true');
 await expect(address).toBeFocused();await expect(address).toHaveValue(RUNTIME);
 await shot(page,'address-corrected');

 await page.locator('#twin-pair-token').fill(token!);
 // The one-use credential stays out of the screenshot.
 if(shots)await page.screenshot({path:`${shots}/N03-pair-form-filled.png`,mask:[page.locator('#twin-pair-token')]});
 expect(toRuntime).toHaveLength(0);
 await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await expect(page.getByTestId('runtime-address-error')).toHaveCount(0);

 await openScenarioPicker(page);
 await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
 await page.getByRole('button',{name:'Chạy mock'}).click();
 await expect(page.getByTestId('mode-badge')).toContainText('MOCK');
 await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
 // the streams are read through fetch with the bearer; the first heartbeat makes the chip live
 const chip=page.getByTestId('runtime-chip');
 await expect(chip).toHaveAttribute('data-state','live',{timeout:15000});await expect(chip).toContainText('Trực tiếp');
 await shot(page,'connected-run-bar');

 // during a paced run every control works with a real pointer at 1× and 16×: the controls keep their elements while steps land
 const T=page.locator('#twin-transport'),btn=(a:string)=>T.locator(`[data-action="${a}"]`),status=page.getByTestId('run-status'),tick=page.getByTestId('run-tick');
 const pauseCount=()=>toRuntime.filter(r=>r.url().endsWith('/actions')&&r.method()==='POST').map(r=>r.postDataJSON()).filter(b=>b.kind==='pause').length;
 const remember=()=>page.evaluate(()=>{(window as unknown as {kept:Element[]}).kept=[...document.querySelectorAll('#twin-transport button,#twin-transport select,#twin-run-speed option,[data-testid="primary-action"],#twin-details [role="tab"]')];return (window as unknown as {kept:Element[]}).kept.length;});
 const allKept=()=>page.evaluate(()=>(window as unknown as {kept:Element[]}).kept.every(n=>n.isConnected));
 await page.locator('[data-action="twin-inspector-toggle"]').click();await expect(page.getByTestId('inspector-tab-objects')).toBeVisible();
 for(const speed of ['1','16']){
  await page.locator('#twin-run-speed').selectOption(speed);await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();
  // node identity: the same transport buttons, select and options, primary action and tabs after several steps. For the select this is the
  // proxy for "an open dropdown stays open" (a replaced select closes); the open native dropdown itself is not observed here
  expect(await remember()).toBeGreaterThan(10);const t0=await tick.textContent();
  await page.waitForTimeout(1300);
  await expect(tick).not.toHaveText(t0!);expect(await allKept(),`controls kept their elements at ${speed}×`).toBe(true);
  await shot(page,`paced-${speed}x`);
  // an inspector tab, then Stop, then Pause: each with a real pointer click, each on the first attempt
  const tab=speed==='1'?'engineering':'report';
  await page.getByTestId(`inspector-tab-${tab}`).click();await expect(page.getByTestId(`inspector-tab-${tab}`)).toHaveAttribute('aria-selected','true');
  await expect(btn('twin-stop')).toBeVisible();
  await btn('twin-stop').click();await expect(btn('twin-play')).toBeVisible();await expect(status).toContainText('Đang chạy');
  await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();await page.waitForTimeout(700);
  const before=pauseCount();
  await btn('twin-pause').click();
  if(speed==='1')await shot(page,'pausing');
  await expect(status).toContainText('Tạm dừng');expect(pauseCount()).toBe(before+1);
  await expect(btn('twin-resume')).toBeFocused();// focus follows the pressed control
  if(speed==='1')await shot(page,'paused');
  await btn('twin-resume').click();await expect(status).toContainText('Đang chạy');
 }
 // U06: the 2D plan is updated in place while paced steps land: a scene entity keeps its node, and one real pointer click on it selects it
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();await page.locator('[data-action="twin-display-toggle"]').click();
 const amr=page.locator('#twin-stage [data-action="twin-pick"][data-value="amr-1"]');await expect(amr).toHaveAttribute('aria-pressed','false');
 await page.locator('#twin-run-speed').selectOption('1');await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();
 await amr.evaluate(n=>{(window as unknown as {amr:Element}).amr=n;});const t2=await tick.textContent();await page.waitForTimeout(1300);
 await expect(tick).not.toHaveText(t2!);expect(await page.evaluate(()=>(window as unknown as {amr:Element}).amr.isConnected),'the 2D entity kept its element').toBe(true);
 await amr.click();await expect(amr).toHaveAttribute('aria-pressed','true');
 await shot(page,'paced-2d-click');
 await btn('twin-stop').click();await expect(btn('twin-play')).toBeVisible();
 await openDisplayMenu(page);await page.getByRole('button',{name:'3D',exact:true}).click();await page.locator('[data-action="twin-display-toggle"]').click();
 // the speed changes through the select while a run is going, and the next steps take it
 await page.locator('#twin-run-speed').selectOption('1');await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();
 await page.waitForTimeout(600);await remember();
 const n16=toRuntime.length;await page.locator('#twin-run-speed').selectOption('16');
 await expect.poll(()=>toRuntime.slice(n16).filter(r=>r.url().endsWith('/actions')).map(r=>r.postDataJSON()).some(b=>b.kind==='step'&&b.payload.pace?.factor===16)).toBe(true);
 expect(await page.evaluate(()=>(window as unknown as {kept:Element[]}).kept.filter(n=>n.matches('#twin-run-speed')).every(n=>n.isConnected))).toBe(true);
 await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:150000});
 // right after completion the final report may still be on its way: the page says so, then it lands
 if(await page.getByTestId('report-pending').isVisible())await shot(page,'final-report-loading');
 await expect(page.getByTestId('report-pending')).toHaveCount(0);
 await expect(page.getByTestId('run-served')).toContainText('2');
 await shot(page,'completed');

 // every runtime request after pairing carried the bearer, none carried a cookie, CSRF header or token in its URL;
 // the bearer is kept in sessionStorage only (and never in the page)
 const session=await page.evaluate(runtime=>({keys:Object.keys(sessionStorage),value:sessionStorage.getItem(`mekoniq-lab-session:${runtime}/lab/v2`),local:JSON.stringify({...localStorage}),html:document.documentElement.outerHTML}),RUNTIME);
 expect(session.value).toBeTruthy();expect(session.local).not.toContain(session.value!);expect(session.html).not.toContain(session.value!);
 const authed=toRuntime.filter(r=>r.method()!=='OPTIONS'&&!r.url().endsWith('/health')&&!r.url().endsWith('/sessions'));
 expect(authed.length).toBeGreaterThan(0);
 for(const r of authed){const h=await r.allHeaders();expect(h.authorization,r.url()).toBe(`Bearer ${session.value}`);expect(h['x-csrf-token'],r.url()).toBeUndefined();expect(h.cookie,r.url()).toBeUndefined();expect(r.url()).not.toContain(session.value!);}
 expect(toRuntime.some(r=>r.url().includes('/events'))).toBe(true);
 // paced auto-run: every step names a factor the runtime accepts and at most 50 ticks
 const steps=authed.filter(r=>r.url().endsWith('/actions')).map(r=>r.postDataJSON()).filter(b=>b.kind==='step'&&b.payload.pace);
 expect(steps.length).toBeGreaterThan(0);for(const b of steps){expect(b.payload.ticks).toBe(20);expect([1,16]).toContain(b.payload.pace.factor);}
 expect(steps.some(b=>b.payload.pace.factor===1)&&steps.some(b=>b.payload.pace.factor===16)).toBe(true);

 // a reload keeps the address and the bearer (the one-use code is spent), but reaching the runtime is still a click
 // and on every page: listened at browser-context level for any request that leaves this page's origin
 const foreign:string[]=[];page.context().on('request',r=>{if(new URL(r.url()).origin!==LAB)foreign.push(`${r.method()} ${r.url()}`);});
 await page.goto(`${LAB}/#assembly`);await page.reload();await expect(page.getByTestId('asm-scene')).toBeVisible();await page.waitForTimeout(1000);
 for(const p of PAGES){await page.goto(`${LAB}/#${p}`);await page.waitForTimeout(300);}
 await page.reload();
 await expect(page.getByTestId('runtime-address')).toHaveText(RUNTIME);await expect(page.locator('#twin-pair-token')).toHaveCount(0);
 await page.waitForTimeout(1500);expect(foreign).toEqual([]);
 // I5: nothing was attempted in this page load: the chip says not connected (neutral), the problem names the Connect way, not "cannot reach"
 await expect(chip).toHaveAttribute('data-state','idle');await expect(chip).toContainText('Chưa kết nối');
 await expect(page.getByTestId('problems-count')).toBeVisible();await page.getByTestId('problems-count').click();
 await expect(page.getByTestId('problems-panel')).toContainText('NOT_CONNECTED');await expect(page.getByTestId('problems-panel')).not.toContainText('RUNTIME_UNREACHABLE');
 if(process.env.LAB_EVIDENCE_DIR)await page.screenshot({path:`${process.env.LAB_EVIDENCE_DIR}/final-I5-chip-not-connected.png`});
 await chip.click();await expect(page.getByTestId('runtime-popover')).toBeVisible();
 await page.locator('[data-action="twin-connect"]').click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await expect(chip).toContainText('Sẵn sàng');
 expect(foreign.some(r=>r.endsWith('/health'))).toBe(true);
 // disconnect drops the bearer from this tab
 await chip.click();await page.locator('[data-action="twin-disconnect"]').click();
 await expect(page.locator('#twin-pair-token')).toBeVisible();await expect(page.locator('#twin-runtime-url')).toHaveValue(RUNTIME);
 expect(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('mekoniq-lab-session:')))).toEqual([]);
});
