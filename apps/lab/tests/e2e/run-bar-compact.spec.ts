import {test,expect} from '@playwright/test';
import {barLayout} from '../support/twin';
// Component layout regression: production markup/CSS and real allowed connection words, no runtime/private-state changes.
test('coffee attention controls and complete runtime words fit one row at 1024px',async({page},testInfo)=>{
 await page.setViewportSize({width:1024,height:700});await page.goto('/#twin');await page.locator('#twin-run-bar').waitFor();
 await page.evaluate(async()=>{
  const module='/src/ui/run-bar.ts',i18n='/src/i18n/index.ts';
  const {runBar,simLabel}=await import(module),{setLocale}=await import(i18n);setLocale('vi');
  document.querySelector('#twin-run-bar')!.outerHTML=runBar({scenarioTitle:'Cà phê sữa đá',runtime:{state:'connecting',label:'Đang kết nối',detail:''},mode:simLabel('mock',false),status:'Cần kiểm tra',simTimeS:4.2,served:'0',problems:1,primary:{action:'twin-resume',label:'Tiếp tục',disabled:false},inspectorOpen:false});
 });
 const layout=await page.locator('#twin-run-bar').evaluate(bar=>({height:bar.getBoundingClientRect().height,width:bar.getBoundingClientRect().width,items:[...bar.querySelectorAll('.twin-runbar-left,.twin-runbar-right,.twin-runbar-left>*,.twin-runbar-right>*')].map(el=>({text:el.textContent,rect:el.getBoundingClientRect().toJSON(),minWidth:getComputedStyle(el).minWidth,gap:getComputedStyle(el).gap,flex:getComputedStyle(el).flex}))}));
 await testInfo.attach('layout',{body:JSON.stringify(layout,null,2),contentType:'application/json'});
 expect(layout.height).toBe(48);
 expect(await barLayout(page)).toEqual({oneLine:true,twelve:true,label:true,overlaps:[],inside:true,noScroll:true,title:true});
 await expect(page.locator('[data-action="twin-inspector-toggle"]')).toHaveAccessibleName('Chi tiết');
 await page.getByTestId('scenario-picker').focus();await page.keyboard.press('Tab');await expect(page.getByTestId('runtime-chip')).toBeFocused();
 for(const locale of ['vi','ja','en'])for(const state of ['live','connecting','failed','lost']){
  await page.evaluate(async({locale,state})=>{
   const module='/src/ui/run-bar.ts',i18n='/src/i18n/index.ts',m=await import(module),{setLocale,tr}=await import(i18n);setLocale(locale);
   const runtime=m.runtimeWord(state==='connecting'?'connecting':state==='lost'?'runtime_lost':'live','fresh',true,false,false,{attempt:state==='failed'?'failed':'ok',pinMismatch:false});
   document.querySelector('#twin-run-bar')!.outerHTML=m.runBar({scenarioTitle:tr('Cà phê sữa đá','アイスミルクコーヒー','Iced milk coffee'),runtime:{...runtime,detail:''},mode:m.simLabel('mock',false),status:tr('Cần kiểm tra','要確認','Needs attention'),simTimeS:4.2,served:'0',problems:1,primary:{action:'twin-resume',label:tr('Tiếp tục','再開','Resume'),disabled:false},inspectorOpen:false});
  },{locale,state});
  const detail=await page.locator('#twin-run-bar').evaluate(el=>({height:el.getBoundingClientRect().height,chipFits:el.querySelector('#twin-runtime-word')!.scrollWidth<=el.querySelector('#twin-runtime-word')!.clientWidth,buttons:[...el.querySelectorAll('button')].map(b=>({text:b.textContent,width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height}))}));
  await testInfo.attach(`${locale}-${state}`,{body:JSON.stringify(detail),contentType:'application/json'});
  expect(detail.height,`${locale} ${state}`).toBe(48);expect(detail.chipFits).toBe(true);for(const b of detail.buttons){expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}
  expect(await barLayout(page),`${locale} ${state}`).toEqual({oneLine:true,twelve:true,label:true,overlaps:[],inside:true,noScroll:true,title:true});
 }

});
