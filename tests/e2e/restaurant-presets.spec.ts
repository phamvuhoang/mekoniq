import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {preset} from '../../packages/domain/src/policy/presets';
import {PRESET_NAMES,presetAcceptance} from '../../packages/domain/src/policy/preset-acceptance';
// W08-T04: the same build serves different restaurant models, chosen only by applying a preset (Configuration.Apply). The dev lab always starts from the restaurant fixture venue.
const coordinator='http://127.0.0.1:3451';
function harness(page:Page,lab=`models-${randomUUID().slice(0,8)}`){
 const api=async(type:string,payload:object,actor='manager')=>(await page.request.post(coordinator+'/commands',{headers:{'x-test-actor':actor,'x-test-lab':lab},data:{type,payload,operationId:randomUUID()}})).json();
 const snapshots=async()=>(await page.request.get(coordinator+'/snapshots',{headers:{'x-test-lab':lab}})).json() as Promise<{ref:{kind:string;id:string};state:Record<string,unknown>}[]>;
 return {
  api,snapshots,
  async screen(path:string,actor='manager'){await page.goto(`${path}?actor=${actor}&lab=${lab}`);await expect(page.getByRole('button',{name:/^(Làm mới|Refresh)$/})).toBeVisible();},
  async apply(name:string){
   const current=(await snapshots()).find(s=>s.ref.kind==='configuration')!,revision=Number(current.state.revision)+1;
   const features=Object.fromEntries(Object.entries(preset(name).features).map(([k,f])=>[k,{status:f.status,revision}]));
   const r=await api('Configuration.Apply',{revision,features});expect(r.status,JSON.stringify(r)).toBe('accepted');
   return Object.entries(features).filter(([,f])=>f.status==='enabled').map(([k])=>k).sort();
  },
 };
}
const navPaths=async(page:Page)=>page.getByRole('navigation').locator('a').evaluateAll(links=>links.map(a=>new URL((a as HTMLAnchorElement).href).pathname));

test('every offered template only switches on modules that exist, and the chain template says what it still waits for',()=>{
 for(const name of PRESET_NAMES){const a=presetAcceptance(name);expect(a.ok,name+JSON.stringify(a)).toBe(true);}
 expect(presetAcceptance('chain').deferred).toEqual(['chain']);
});

test('cafe: counter ordering and payment screens are offered, robot and booking screens are not',async({page})=>{
 const h=harness(page);
 expect(await h.apply('cafe')).not.toContain('fleet');
 await h.screen('/pos');
 const paths=await navPaths(page);
 expect(paths).toEqual(expect.arrayContaining(['/pos','/kitchen','/checkout','/cash']));
 expect(paths).not.toEqual(expect.arrayContaining(['/fleet']));
 expect(paths).not.toEqual(expect.arrayContaining(['/reservations']));
 await h.screen('/models');
 await expect(page.getByText('Chức năng đang tắt')).toBeVisible(); // buffet/combo/weighed models are not part of the cafe template
});

test('buffet template offers the service-models screen over the same fixture menu',async({page})=>{
 const h=harness(page);
 await h.apply('buffet');
 await h.screen('/models');
 await expect(page.getByRole('heading',{name:'Buffet, combo và món theo cân',level:2})).toBeVisible();
});

test('robot-only template needs no menu: ordering screens disappear, fleet stays',async({page})=>{
 const h=harness(page);
 expect(await h.apply('robot-only')).toEqual(expect.arrayContaining(['fleet','robot.delivery']));
 await h.screen('/fleet');
 const paths=await navPaths(page);
 expect(paths).toEqual(expect.arrayContaining(['/fleet']));
 expect(paths).not.toEqual(expect.arrayContaining(['/pos','/checkout']));
});

test('trial-service still offers only the trial functions after the new templates exist',async({page})=>{
 const h=harness(page);
 const enabled=await h.apply('trial-service');
 expect(enabled).toEqual(['fleet','fulfillment','robot.bussing','robot.delivery']);
 await h.screen('/fleet');
 expect(await navPaths(page)).not.toEqual(expect.arrayContaining(['/pos','/inventory','/staff']));
});
