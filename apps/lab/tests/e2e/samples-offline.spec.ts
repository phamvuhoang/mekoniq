// The two shipped samples with no runtime: every request outside the page's own origin is blocked. Also the accessibility and layout sweep of the R5 panels
// (electrical section, shipped samples) at three widths and three languages.
import {test,expect,type Page} from '@playwright/test';
import axe from 'axe-core';
declare global { interface Window { axe: typeof axe } }
const serious=(page:Page)=>page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.slice(0,3).map(n=>n.target.join(' '))}));});
const open=async(page:Page,lang='EN')=>{
 await page.route(url=>!url.href.startsWith('http://127.0.0.1')&&!url.href.startsWith('http://localhost')&&!url.href.startsWith('data:')&&!url.href.startsWith('blob:'),r=>r.abort());
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#assembly');await page.getByRole('button',{name:lang,exact:true}).click();
 await expect(page.getByTestId('samples')).toBeVisible();await page.evaluate(()=>document.fonts.ready);await page.addScriptTag({content:axe.source});
};
const noOverflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);

test('hardware candidate sample: allocation, checks, wires and checklist, read back before it is shown',async({page})=>{
 await open(page);
 await page.getByRole('button',{name:'Hardware candidate package'}).click();
 await expect(page.getByTestId('sample-verify')).toHaveAttribute('data-ok','true');
 await expect(page.getByTestId('sample-readiness')).toContainText('draft · hardwareValidated: false · controlAuthority: false');
 await expect(page.getByTestId('samples').getByTestId('el-allocation')).toBeVisible();
 await expect(page.getByTestId('samples').getByTestId('el-checks')).toContainText('UNVERIFIED');
 await expect(page.getByTestId('samples').getByTestId('el-wires')).toBeVisible();
 await expect(page.getByTestId('sample-checklist')).toContainText('UNVERIFIED');
 await expect(page.getByTestId('samples').getByRole('button',{name:/Compile|Export/})).toHaveCount(0);
});
test('stop report sample: the four stop kinds side by side with a distance or "no data", and the not_calibrated line',async({page})=>{
 await open(page);
 await page.getByRole('button',{name:'Stop report'}).click();
 await expect(page.getByTestId('sample-verify')).toHaveAttribute('data-ok','true');
 const rows=page.getByTestId('sample-stop-table').locator('tbody tr');
 await expect(rows).toHaveCount(4);
 for(const r of await rows.all())await expect(r).toContainText(/\d+(\.\d+)? m|no data/);
 await expect(page.getByTestId('sample-calibration')).toContainText('not_calibrated');
});
test('a sample that does not match its checksum is not shown',async({page})=>{
 await open(page);
 await page.route('**/samples/stop-report/s1-normal.json',async r=>{const res=await r.fetch();const body=Buffer.from(await res.body());body[5]=body[5]!^1;await r.fulfill({response:res,body});});
 await page.getByRole('button',{name:'Stop report'}).click();
 await expect(page.getByTestId('sample-verify')).toHaveAttribute('data-ok','false');
 await expect(page.getByTestId('sample-verify')).toContainText('s1-normal.json');
 await expect(page.getByTestId('sample-stop-table')).toHaveCount(0);
});
for(const width of [390,1024,1440])for(const lang of ['VI','JA','EN'])test(`R5 panels at ${width}px in ${lang}: no serious accessibility violation, no horizontal overflow`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page,lang);
 await expect(page.getByTestId('el-section')).toBeVisible();
 expect(await serious(page),'electrical + samples closed').toEqual([]);
 await page.locator('[data-action="el-sample"]').first().click();await expect(page.getByTestId('sample-verify')).toBeVisible();
 expect(await serious(page),'hardware sample').toEqual([]);expect(await noOverflow(page),'overflow (hardware sample)').toBe(true);
 await page.locator('[data-action="el-sample"]').nth(1).click();await expect(page.getByTestId('sample-stop-table')).toBeVisible();
 expect(await serious(page),'stop sample').toEqual([]);expect(await noOverflow(page),'overflow (stop sample)').toBe(true);
});
