// WEB07 (R4 plan V16): a panel of the Lab, open on a real run, is checked in the three languages at 390/1024/1440 px: axe serious/critical violations, reduced motion honoured (no running CSS animation or transition), no horizontal scroll.
// The rows are written next to the screenshots (LAB_EVIDENCE_DIR) as web07-<panel>.json; scripts/record-r4-web.mjs gathers them. A panel that disappears on a language switch fails here, it is never skipped.
import {expect,type Page} from '@playwright/test';
import axe from 'axe-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
// @ts-expect-error JavaScript CLI boundary
import {verifyProductionUi} from '../../scripts/production-ui.mjs';
declare global { interface Window { axe: typeof axe } }
const TARGETS:Record<string,string[]>={control:['control-bench'],faults:['fault-evidence'],tray:['tray-hint'],belief:['belief-legend'],calibration:['calibration-record','calibration-fitted','calibration-residuals','calibration-domain','calibration-plot']};
type Target={panel:string;testId:string;state?:'populated'|'empty'|'error'};
export async function assertWeb07Content(page:Page,o:Target){
 const ids=o.panel==='calibration'&&o.state&&o.state!=='populated'?[`calibration-${o.state}`]:TARGETS[o.panel];if(!ids||ids[0]!==o.testId)throw Error('WEB07_TARGET_MISMATCH');
 for(const id of ids)if(!await page.getByTestId(id).isVisible())throw Error('WEB07_CONTENT_MISSING:'+id);
 if(o.panel==='calibration'&&(!o.state||o.state==='populated')){
  for(const id of ['calibration-fitted','calibration-residuals','calibration-domain'])if(await page.getByTestId(id).locator('tbody th[scope="row"]').count()<1)throw Error('WEB07_CONTENT_EMPTY:'+id);
  for(const id of ['measured','predicted'])if(await page.getByTestId('calibration-plot').locator(`svg [data-series="${id}"]`).count()<1)throw Error('WEB07_SERIES_MISSING:'+id);
 }
 return ids;
}
export type Web07Row={panel:string;lang:'vi'|'ja'|'en';width:number;axeSeriousCritical:number;axeIds:string[];reducedMotion:boolean;horizontalScroll:boolean;populated:boolean;productionSha256:string};
export async function sweepWeb07(page:Page,o:Target&{reopen?:()=>Promise<void>}){
 const dir=process.env.LAB_EVIDENCE_DIR;if(!dir)throw Error('WEB07_PRODUCTION_EVIDENCE_REQUIRED');
 const url=new URL('/',page.url()).href,productionSha256:string=await verifyProductionUi({url,evidenceDir:dir});
 const requiredTestIds=await assertWeb07Content(page,o);
 const rows:Web07Row[]=[];await page.emulateMedia({reducedMotion:'reduce'});
 for(const [lang,button] of [['vi','VI'],['ja','JA'],['en','EN']] as const){
  await page.getByRole('button',{name:button,exact:true}).click();await o.reopen?.();
  await expect(page.getByTestId(o.testId),`${o.panel} after switching to ${lang}`).toBeVisible();
  for(const width of [390,1024,1440]){
   await page.setViewportSize({width,height:width===390?844:900});await o.reopen?.();await assertWeb07Content(page,o);await page.evaluate(()=>document.fonts.ready);
   if(!await page.evaluate(()=>typeof window.axe==='object'))await page.addScriptTag({content:axe.source});
   const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>v.id);});
   const state=await page.evaluate(()=>({reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,running:document.getAnimations().filter(a=>a.playState==='running'&&(a as CSSAnimation).animationName!==undefined||a.playState==='running'&&(a as CSSTransition).transitionProperty!==undefined).length,scroll:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}));
   rows.push({panel:o.panel,lang,width,axeSeriousCritical:violations.length,axeIds:violations,reducedMotion:state.reduce&&state.running===0,horizontalScroll:state.scroll,populated:!o.state||o.state==='populated',productionSha256});
  }
 }
 expect(await verifyProductionUi({url,evidenceDir:dir})).toBe(productionSha256);
 mkdirSync(dir,{recursive:true});writeFileSync(join(dir,`web07-${o.panel}${o.state&&o.state!=='populated'?'-'+o.state:''}.json`),JSON.stringify({schemaVersion:1,panel:o.panel,state:o.state??'populated',testId:o.testId,requiredTestIds,productionSha256,rows},null,1)+'\n');
 for(const r of rows){expect(r.axeSeriousCritical,`axe ${r.panel} ${r.lang} ${r.width}: ${r.axeIds.join(',')}`).toBe(0);expect(r.reducedMotion,`reduced motion ${r.panel} ${r.lang} ${r.width}`).toBe(true);expect(r.horizontalScroll,`horizontal scroll ${r.panel} ${r.lang} ${r.width}`).toBe(false);}
 return rows;
}
