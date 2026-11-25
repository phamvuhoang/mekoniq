import {expect,type Page} from '@playwright/test';
import type {InspectorTab} from '../../src/ui/inspector';
// Containers of the Digital twin page (U01): open one before acting on, or asserting the visibility of, something inside it. Idempotent.
export async function openInspector(page:Page,tab:InspectorTab):Promise<void>{
 if(!await page.getByTestId('twin-inspector').isVisible())await page.locator('[data-action="twin-inspector-toggle"]').click();
 const t=page.getByTestId(`inspector-tab-${tab}`);
 if(await t.getAttribute('aria-selected')!=='true')await t.click();
 await expect(page.locator(`#inspector-panel-${tab}`)).toBeVisible();
}
export async function openDisplayMenu(page:Page):Promise<void>{
 if(!await page.getByTestId('display-menu').isVisible())await page.locator('[data-action="twin-display-toggle"]').click();
 await expect(page.getByTestId('display-menu')).toBeVisible();
}
/** The scenario picker (U02): one button per preset, runnable ones first. */
export async function openScenarioPicker(page:Page):Promise<void>{
 if(!await page.locator('#twin-picker').isVisible())await page.getByTestId('scenario-picker').click();
 await expect(page.locator('#twin-picker')).toBeVisible();
}
/** The problems list (U02) opens from the run bar's count, which exists only while there is a problem. */
export async function openProblems(page:Page):Promise<void>{
 if(!await page.getByTestId('problems-panel').isVisible())await page.getByTestId('problems-count').click();
 await expect(page.getByTestId('problems-panel')).toBeVisible();
}

/** I3: the run bar widths the layout is asserted at. */
export const WIDTHS:[number,number][]=[[1440,900],[1280,800],[1024,700]];
/** What I3 requires of the bar, measured: the scenario on one line with ≥ 12 characters (or the whole name) visible, the label whole, no two items
 * overlapping, no horizontal page scroll. */
export async function barLayout(page:Page){
 return page.evaluate(()=>{
  const b=document.querySelector('#twin-scenario-value') as HTMLElement,name=b.textContent??'',line=parseFloat(getComputedStyle(b).lineHeight)||16;
  const text=b.firstChild as Text,r=document.createRange();r.setStart(text,0);r.setEnd(text,Math.min(12,name.length));
  const ellipsis=b.scrollWidth>b.clientWidth?8:0,visible=r.getBoundingClientRect().right<=b.getBoundingClientRect().right-ellipsis+0.5;
  const mode=document.querySelector('[data-testid="mode-badge"] span') as HTMLElement;
  const items=[...document.querySelectorAll('#twin-run-bar .twin-runbar-left>*,#twin-run-bar .twin-runbar-right>*')].filter(e=>(e as HTMLElement).offsetParent!==null&&!e.classList.contains('visually-hidden')).map(e=>({id:(e as HTMLElement).dataset.testid??e.className,r:e.getBoundingClientRect()}));
  const overlaps:string[]=[];for(const [i,a] of items.entries())for(const c of items.slice(i+1))if(a.r.left<c.r.right-0.5&&c.r.left<a.r.right-0.5&&a.r.top<c.r.bottom-0.5&&c.r.top<a.r.bottom-0.5)overlaps.push(`${a.id}×${c.id}`);
  const bar=document.getElementById('twin-run-bar')!.getBoundingClientRect();
  return {oneLine:b.getBoundingClientRect().height<line*1.6,twelve:visible,label:mode.scrollWidth<=mode.clientWidth+0.5&&mode.getBoundingClientRect().right<=innerWidth,overlaps,
   inside:items.every(x=>x.r.right<=bar.right+0.5&&x.r.left>=bar.left-0.5),noScroll:document.documentElement.scrollWidth<=innerWidth+1,title:document.querySelector('[data-testid="scenario-picker"]')!.getAttribute('title')===name};
 });
}
