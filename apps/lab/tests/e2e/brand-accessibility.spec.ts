import {test,expect,type Page} from '@playwright/test';
import axe from 'axe-core';
import {openDisplayMenu,openInspector} from '../support/twin';
declare global { interface Window { axe: typeof axe } }
const serious=(page:Page)=>page.evaluate(async()=>{const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}));});
const open=async(page:Page,route:string)=>{await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/#'+route);await page.evaluate(()=>document.fonts.ready);await page.addScriptTag({content:axe.source});};
for(const route of ['design','restaurant','scenarios','twin','results','deployment'])test(`accessible brand surface: ${route}`,async({page})=>{
 await open(page,route);
 expect(await serious(page)).toEqual([]);
});
test('accessible twin page: each details tab open, then the Display menu open (with the viewport tool buttons)',async({page})=>{
 await open(page,'twin');
 for(const tab of ['objects','engineering','report','setup'] as const){await openInspector(page,tab);expect(await serious(page),tab).toEqual([]);}
 await openDisplayMenu(page);
 await expect(page.locator('[data-action="twin-help"]').first()).toBeVisible();
 expect(await serious(page),'display menu').toEqual([]);
});
test('compact heading controls retain touch targets',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/#design');
 // the Design page re-renders once shortly after load: measure every heading button of one render, retrying until a render holds still
 await expect(async()=>{
  const boxes=await page.locator('.heading-actions button').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent?.trim(),connected:b.isConnected,width:r.width,height:r.height};}));
  expect(boxes.length).toBeGreaterThan(0);
  for(const b of boxes){expect(b.connected,b.text).toBe(true);expect(b.height,b.text).toBeGreaterThanOrEqual(44);expect(b.width,b.text).toBeGreaterThanOrEqual(44);}
 }).toPass({timeout:10000});
});
test('print captions and highlighted values use dark ink',async({page})=>{
 await page.goto('/#design');await page.emulateMedia({media:'print'});
 await expect(page.locator('.metric small').first()).toHaveCSS('color','rgb(20, 48, 52)');
 await expect(page.locator('.metric p').first()).toHaveCSS('color','rgb(20, 48, 52)');
 await expect(page.locator('.metric.cost strong')).toHaveCSS('color','rgb(20, 48, 52)');
});
