// V12 / BEL06: the belief layer on the real MuJoCo cell. A belief_estimated run (request carries the registered ids only) → the report has the attempts table → the exported package opens offline
// and its ghost at a mid-run cursor is the record at that cursor → an older report (R2b sample) says "No perception data". Launch (one spec per launcher, the machine may be slow: the run is ~2000 ticks):
//   node scripts/test-irsim-e2e.mjs --same-origin --provider mujoco --mujoco-mobile --ui-port 42455 --runtime-port 42456 mujoco-belief.spec.ts
import {test,expect,type Request} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {openInspector,openScenarioPicker} from '../support/twin';
import {sweepWeb07} from '../support/web07';
const token=process.env.LAB_TEST_PAIRING_TOKEN,runtime=process.env.LAB_TEST_RUNTIME_URL;
const isCreate=(r:Request)=>r.method()==='POST'&&/\/lab\/v2\/runs$/.test(r.url());
test('belief_estimated cell: ids in the request, attempts in the report, the exported package draws the belief at the cursor, an older report has no perception data',async({page})=>{
 test.setTimeout(900000);page.setDefaultTimeout(60000);expect(token).toBeTruthy();
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();if(runtime)await page.locator('#twin-runtime-url').fill(runtime);
 await page.locator('#twin-pair-token').fill(token!);await page.locator('#twin-pair-form button[type="submit"]').click();await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="mujoco-cell"]').click();await openInspector(page,'setup');
 // the mode is chosen before the run: three radios, the fixed program by default, in three languages; the nominal profile is stated in words, never sent as numbers
 const modes=page.getByTestId('grasp-mode');await expect(modes).toBeVisible();await expect(page.locator('#twin-grasp-mode-fixed_program')).toBeChecked();
 for(const [button,word] of [['JA','認識'],['VI','Nhận thức'],['EN','Perception']] as const){await page.getByRole('button',{name:button,exact:true}).click();await expect(modes.locator('legend')).toContainText(word);}
 await page.locator('#twin-grasp-mode-belief_estimated').check();await expect(page.getByTestId('grasp-profile')).toContainText('σ 2 mm');await expect(page.getByTestId('grasp-profile')).toContainText('Assumed');
 await expect(page.locator('[data-action="twin-run"]').first()).toBeEnabled({timeout:120000});
 const created=page.waitForResponse(r=>isCreate(r.request()));await page.locator('[data-action="twin-run"]').first().click();const response=await created;expect(response.status()).toBe(201);
 const body=response.request().postDataJSON();expect(body).toMatchObject({graspMode:'belief_estimated',perceptionProfileId:'perception-nominal-v1'});expect(JSON.stringify(body)).not.toMatch(/sigma|dropout|biasM/i);
 await expect(page.locator('[data-action="twin-play"]').first()).toBeEnabled({timeout:120000});
 await page.locator('#twin-run-speed').selectOption('16');await page.locator('[data-action="twin-play"]').first().click();
 await expect(page.locator('#twin-transport-time')).toContainText(/tick (19|2\d)\d\d/,{timeout:600000});
 await page.locator('[data-action="twin-stop"]').first().click();await expect(page.locator('[data-action="twin-cancel"]').first()).toBeEnabled({timeout:60000});
 await openInspector(page,'report');if(await page.locator('[data-action="twin-report-reload"]').count())await page.locator('[data-action="twin-report-reload"]').first().click();
 const row=page.getByTestId('perception-attempts').locator('tr[data-attempt="cup-1#0"]');
 await expect(row).toBeVisible({timeout:120000});await expect(row.locator('[data-gate="belief"]')).toHaveAttribute('data-pass','true');await expect(row.locator('td[data-outcome]')).toHaveAttribute('data-outcome','lifted');
 await expect(page.getByTestId('perception-evidence')).toContainText(/not camera data/i);
 // 390 px: the attempts table scrolls inside its own region, the page does not
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await page.setViewportSize({width:1440,height:900});
 // the exported package: the report travels inside it with the stream
 const folder=mkdtempSync('/tmp/mekoniq-belief-pkg-'),zip=join(folder,'belief.zip'),download=page.waitForEvent('download',{timeout:300000});
 await page.locator('[data-action="twin-world-export"]').first().click();await(await download).saveAs(zip);execFileSync('unzip',['-q',zip,'-d',join(folder,'pkg')]);
 const manifest=JSON.parse(readFileSync(join(folder,'pkg/manifest.json'),'utf8')),asset=manifest.assets.find((a:{role:string})=>a.role==='report'),raw=readFileSync(join(folder,'pkg',asset.path));
 const report=JSON.parse((asset.encoding==='gzip'?gunzipSync(raw):raw).toString()),beliefs=report.perceptionEvidence.beliefs as {tick:number;objectId:string;belief:unknown;dropped:boolean;errorM:number|null}[];
 expect(report.perceptionEvidence.attempts.length).toBeGreaterThan(0);
 const cursor=1400,expected=[...beliefs].reverse().find(r=>r.objectId==='cup-1'&&r.tick<=cursor&&r.belief)!;expect(expected).toBeTruthy();
 const offline=await page.context().newPage();const attempts:string[]=[];await offline.route('**/lab/**',r=>{attempts.push(r.request().url());return r.abort();});
 await offline.setViewportSize({width:1440,height:900});await offline.goto('/#replay');await offline.getByRole('button',{name:'EN',exact:true}).click().catch(()=>{});
 await offline.locator('.replay-files>summary').click();await offline.locator('#replay-import').setInputFiles(join(folder,'pkg'));await expect(offline.locator('#replay-cursor')).toBeVisible({timeout:90000});
 await offline.locator('#replay-cursor').evaluate((el:HTMLInputElement,t)=>{el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},cursor);await expect(offline.locator('#replay-time')).toContainText(`tick ${cursor}`);
 const legend=offline.getByTestId('belief-legend');await expect(legend).toHaveAttribute('data-state','data',{timeout:30000});
 await sweepWeb07(offline,{panel:'belief',testId:'belief-legend'});
 await expect(offline.locator('#replay-stage canvas')).toHaveAttribute('data-belief-state','data');await expect(offline.locator('#replay-stage canvas')).toHaveAttribute('data-beliefs',/cup-1/);
 await expect(legend).toContainText(`cup-1 ↔ ${Number((expected.errorM! *1000).toFixed(1))} mm`);
 // the 2D plan draws the same record: dashed belief, solid truth dot, the error
 await offline.getByRole('button',{name:'2D',exact:true}).click();const ghost=offline.locator('#replay-stage [data-belief="cup-1"]');await expect(ghost).toHaveAttribute('data-error-mm',(expected.errorM!*1000).toFixed(2));
 // the table lists only the attempts decided up to the cursor: nothing believed yet at tick 5 (the first estimate is published at tick 10: update period 10, latency 5)
 await offline.locator('#replay-cursor').evaluate((el:HTMLInputElement)=>{el.value='5';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(offline.getByTestId('belief-legend')).toHaveAttribute('data-state',/no_data_at_cursor|none/);await expect(offline.locator('#replay-stage [data-belief]')).toHaveCount(0);
 expect(attempts).toEqual([]);await offline.close();
 // an older (R2b) report has no perception stream: said in words, no ghost
 const old=await page.context().newPage();await old.route('**/lab/**',r=>r.abort());await old.setViewportSize({width:390,height:844});await old.goto('/#replay/coffee-delivery');await expect(old.locator('#replay-cursor')).toBeVisible({timeout:90000});
 await expect(old.getByTestId('belief-legend')).toHaveAttribute('data-state','none');await expect(old.getByTestId('belief-legend')).toContainText(/No perception data|không có dữ liệu nhận thức|認識データなし/i);await expect(old.locator('[data-belief]')).toHaveCount(0);
 expect(await old.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);await old.close();
});
