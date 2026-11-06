import axe from 'axe-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,type Page} from '@playwright/test';
/** Checks rendered WCAG surfaces; retains lower-severity findings beside the screenshots. */
export async function checkBrandAccessibility(page:Page){
 await page.evaluate(()=>document.fonts.ready);
 expect(await page.locator('body').evaluate(n=>getComputedStyle(n).fontFamily)).toContain('Be Vietnam Pro');
 expect(await page.evaluate(()=>document.fonts.check('16px "Be Vietnam Pro"'))).toBe(true);
 expect(await page.evaluate(()=>performance.getEntriesByType('resource').filter(r=>r.name.includes('.woff2')).every(r=>new URL(r.name).origin===location.origin))).toBe(true);
 await page.addScriptTag({content:axe.source});
 const violations=await page.evaluate(async()=>{const engine=(window as unknown as {axe:typeof axe}).axe;return (await engine.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));});
 const url=new URL(page.url()),route=url.pathname.replace(/^\/(menu|order|table)\/.+$/,'/$1'),app=url.port==='3452'?'tablet':'cloud';
 mkdirSync('.lab/brand-ui/source-final',{recursive:true});
 writeFileSync('.lab/brand-ui/source-final/axe-'+app+'-'+(route.replaceAll('/','-')||'home')+'.json',JSON.stringify({route,viewport:page.viewportSize(),violations},null,2));
 expect(violations.filter(v=>v.impact==='serious'||v.impact==='critical')).toEqual([]);
}
