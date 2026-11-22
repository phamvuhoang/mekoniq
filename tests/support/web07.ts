// WEB07 (R4 plan V16): a panel of the Lab, open on a real run, is checked in the three languages at 390/1024/1440 px: axe serious/critical violations, reduced motion honoured (no running CSS animation or transition), no horizontal scroll.
// The rows are written next to the screenshots (LAB_EVIDENCE_DIR) as web07-<panel>.json; scripts/record-r4-web.mjs gathers them. A panel that disappears on a language switch fails here, it is never skipped.
import {expect,type Page} from '@playwright/test';
import axe from 'axe-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
declare global { interface Window { axe: typeof axe } }
export type Web07Row={panel:string;lang:'vi'|'ja'|'en';width:number;axeSeriousCritical:number;axeIds:string[];reducedMotion:boolean;horizontalScroll:boolean};
export async function sweepWeb07(page:Page,o:{panel:string;testId:string;reopen?:()=>Promise<void>}){
 const rows:Web07Row[]=[];await page.emulateMedia({reducedMotion:'reduce'});
 for(const [lang,button] of [['vi','VI'],['ja','JA'],['en','EN']] as const){
  await page.getByRole('button',{name:button,exact:true}).click();await o.reopen?.();
  await expect(page.getByTestId(o.testId),`${o.panel} after switching to ${lang}`).toBeVisible();
  for(const width of [390,1024,1440]){
   await page.setViewportSize({width,height:width===390?844:900});await o.reopen?.();await expect(page.getByTestId(o.testId)).toBeVisible();await page.evaluate(()=>document.fonts.ready);
   if(!await page.evaluate(()=>typeof window.axe==='object'))await page.addScriptTag({content:axe.source});
   const violations=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>v.id);});
   const state=await page.evaluate(()=>({reduce:matchMedia('(prefers-reduced-motion: reduce)').matches,running:document.getAnimations().filter(a=>a.playState==='running'&&(a as CSSAnimation).animationName!==undefined||a.playState==='running'&&(a as CSSTransition).transitionProperty!==undefined).length,scroll:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}));
   rows.push({panel:o.panel,lang,width,axeSeriousCritical:violations.length,axeIds:violations,reducedMotion:state.reduce&&state.running===0,horizontalScroll:state.scroll});
  }
 }
 const dir=process.env.LAB_EVIDENCE_DIR;if(dir){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,`web07-${o.panel}.json`),JSON.stringify({schemaVersion:1,panel:o.panel,testId:o.testId,rows},null,1)+'\n');}
 for(const r of rows){expect(r.axeSeriousCritical,`axe ${r.panel} ${r.lang} ${r.width}: ${r.axeIds.join(',')}`).toBe(0);expect(r.reducedMotion,`reduced motion ${r.panel} ${r.lang} ${r.width}`).toBe(true);expect(r.horizontalScroll,`horizontal scroll ${r.panel} ${r.lang} ${r.width}`).toBe(false);}
 return rows;
}
