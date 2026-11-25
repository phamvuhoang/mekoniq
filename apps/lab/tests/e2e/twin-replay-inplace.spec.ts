import {test,expect,type Page} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
// I1: replay of a just-finished run updates the run bar in place (morph), as the paced run does: a pointer press held across several updates still
// activates the control, a focused control keeps focus, an open box keeps its scroll, and nothing in the run bar is replaced while nothing about it changes.
// Against the mock launcher: node scripts/test-mock-e2e.mjs twin-replay-inplace.spec.ts
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_EVIDENCE_DIR;
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/final-${name}.png`});};
type W=Window&{__removed:number;__bar:Element|null};
/** Count element nodes removed under the run bar from now on, and remember the bar element itself. */
const watchBar=(page:Page)=>page.evaluate(()=>{const w=window as unknown as W&{__mo?:MutationObserver};w.__mo?.disconnect();w.__removed=0;const bar=document.getElementById('twin-run-bar')!;w.__bar=bar;
 w.__mo=new MutationObserver(ms=>{for(const m of ms)for(const n of m.removedNodes)if(n.nodeType===1)w.__removed++;});w.__mo.observe(bar,{childList:true,subtree:true});});
const barState=(page:Page)=>page.evaluate(()=>{const w=window as unknown as W;return {removed:w.__removed,same:document.getElementById('twin-run-bar')===w.__bar};});
/** A real pointer press held for `ms` (several update periods) before release. */
async function hold(page:Page,selector:string,ms=400){const b=(await page.locator(selector).boundingBox())!;await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(ms);await page.mouse.up();}
const blur=(page:Page)=>page.evaluate(()=>(document.activeElement as HTMLElement|null)?.blur());

test('replay of a finished run: the run bar updates in place, playing and not playing',async({page})=>{
 test.skip(!token,'Run scripts/test-mock-e2e.mjs twin-replay-inplace.spec.ts: it starts the pinned source runtime and supplies its one-time token.');
 test.setTimeout(240000);
 await page.setViewportSize({width:1280,height:640});
 await page.goto('/#twin');
 await page.locator('#twin-pair-token').fill(token!);
 await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
 await page.getByTestId('primary-action').click();
 await expect(page.getByTestId('run-status')).toContainText('Đang chạy');
 await page.locator('#twin-run-speed').selectOption('64');
 await page.locator('#twin-transport [data-action="twin-play"]').click();
 await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:180000});
 await openInspector(page,'report');
 await page.getByRole('button',{name:'Xem lại (chỉ đọc)'}).click();
 await expect(page.locator('#twin-replay-cursor')).toBeVisible();
 await page.locator('#twin-replay-cursor').fill('0');
 const toggle='#twin-run-bar [data-action="twin-inspector-toggle"]',expanded=()=>page.locator(toggle).getAttribute('aria-expanded');

 // not playing: the ticker runs every 100 ms, nothing in the bar changes, so nothing is replaced
 await watchBar(page);await page.waitForTimeout(1000);
 expect(await barState(page)).toEqual({removed:0,same:true});
 for(const playing of [false,true]){
  if(playing){await page.locator('[data-action="twin-replay-play"]').click();await expect(page.getByRole('button',{name:'Dừng phát'})).toBeVisible();}
  await watchBar(page);
  // a press held across ≥ 3 update periods (100 ms, 50 ms while playing) still activates the control
  const before=await expanded();await hold(page,toggle);await expect(page.locator(toggle)).not.toHaveAttribute('aria-expanded',before!);
  // a focused run-bar control keeps focus
  await blur(page);await page.getByTestId('scenario-picker').focus();await watchBar(page);await page.waitForTimeout(400);await expect(page.getByTestId('scenario-picker')).toBeFocused();
  expect(await barState(page)).toEqual(playing?{removed:(await barState(page)).removed,same:true}:{removed:0,same:true});
  // an open box keeps its scroll position
  await openScenarioPicker(page);await watchBar(page);
  const box=page.locator('#twin-picker');expect(await box.evaluate(e=>e.scrollHeight>e.clientHeight)).toBe(true);
  await box.evaluate(e=>{e.scrollTop=40;});await page.waitForTimeout(400);
  expect(await box.evaluate(e=>e.scrollTop)).toBe(40);
  await expect(box).toBeVisible();
  if(playing)await shot(page,'I1-replay-playing-box-open');
  expect((await barState(page)).same).toBe(true);
  await page.getByTestId('scenario-picker').click();await expect(box).toBeHidden();
 }
});
