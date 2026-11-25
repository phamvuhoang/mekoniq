// The Assembly page must compile with the session paired on the Twin page. The runtime here is a route-level fake that enforces the CSRF header exactly
// like the real gateway, so two independent clients (the old wiring) fail with 403 CSRF_INVALID.
import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

// the fake reports the Lab's pin: the runtime box compares every runtime's commit with it before pairing (U06)
const health={protocolMajors:[2],sourceCommit:(JSON.parse(readFileSync('config/source-runtime.lock.json','utf8')) as {sourceCommit:string}).sourceCommit,schemaHash:'d'.repeat(64),scenarioIds:[],backends:[],backendSets:[],capabilities:['engineering_bundle_v1']};
async function fakeRuntime(page:Page){
  const seen:{path:string;csrf:string|undefined;status:number}[]=[];
  await page.route('**/lab/v2/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname.replace('/lab/v2',''),csrf=route.request().headers()['x-csrf-token'];
    const json=(status:number,body:unknown)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(path==='/health')return json(200,health);
    if(path==='/sessions'){seen.push({path,csrf,status:201});return json(201,{csrfToken:'csrf-from-pairing'});}
    if(path==='/engineering/compile'){
      const ok=csrf==='csrf-from-pairing';seen.push({path,csrf,status:ok?200:403});
      return ok?json(200,{state:'rejected',projectDigest:'e'.repeat(64),profile:'engineering-rigid-v1',problems:[{code:'FIXTURE_ONLY',path:'/',blocking:true,detail:'route fake'}]}):json(403,{error:'CSRF_INVALID'});
    }
    return json(404,{error:'NOT_FOUND'});
  });
  return seen;
}
test('compile on the Assembly page carries the CSRF token obtained by pairing on the Twin page',async({page})=>{
  const seen=await fakeRuntime(page);
  await page.goto('/#twin');
  await page.locator('#twin-pair-token').fill('one-use-token');
  await page.getByRole('button',{name:'Ghép nối runtime'}).click();
  await expect.poll(()=>seen.some(s=>s.path==='/sessions')).toBe(true);
  await page.goto('/#assembly');
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await expect(page.getByTestId('assembly-page')).toBeVisible();
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await page.getByRole('button',{name:'Compile on runtime'}).click();
  await expect.poll(()=>seen.find(s=>s.path==='/engineering/compile')?.status).toBe(200);
});
