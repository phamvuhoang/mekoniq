// INT15 (U06): MJ-BV01 against the real pinned runtime and the real MuJoCo worker, from the Lab UI (scripts/test-irsim-e2e.mjs --provider mujoco tests/e2e/mujoco-coffee.spec.ts).
// The runtime box in its three states, pairing through it, the mujoco-coffee preset at 1× for 10 s (with one real pointer Pause/Resume), then 16× to completed;
// the 3D view draws the xArm 6 from its meshes and the plant's cups without rebuilding the scene, the joints read thực (MuJoCo) / lệnh, and the report carries
// the plant block. Ignored by the default Playwright config; without the launcher's pairing code it FAILS (never skipped). Screenshots are candidate evidence only.
import {test,expect,type Page} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,dir=process.env.LAB_EVIDENCE_DIR??process.env.LAB_IRSIM_SCREENSHOTS;
const shot=async(page:Page,name:string)=>{if(dir)await page.screenshot({path:`${dir}/U06-${name}.png`});};
const simS=async(page:Page)=>Number(((await page.getByTestId('run-tick').locator('b').textContent())??'').replace(',','.').replace(/[^\d.]/g,''));
interface Report {outcome:{status:string;served:string;tick:number};coverage:Record<string,boolean>;manifest:{scenario:{id:string};backends:{id:string}[]};
 arm?:{armPlant:{engine:string;grip:string;calibration:string};collision:{result:string};waypoints?:{table:unknown[]};releaseTimeoutTicks?:number};coffee?:{armTrace:{stop:unknown}}}

test('MJ-BV01 from the Lab UI: runtime box, mujoco-coffee at 1× then 16× to completed, the mesh arm and cups, both joint columns and the plant report',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider mujoco tests/e2e/mujoco-coffee.spec.ts: it starts lab:mujoco with the real MuJoCo worker and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(900000);
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 // 0. a page from the web (not this machine's loopback; its requests are served from the launcher's UI): "Máy này" is the runtime on the user's machine
 const web=await context.newPage();
 await web.route('http://lab.example.test/**',async r=>{const u=new URL(r.request().url());if(u.pathname.startsWith('/lab/'))return r.fulfill({status:404,contentType:'application/json',body:'{"error":"NO_RUNTIME_ON_THIS_ORIGIN"}'});return r.fulfill({response:await r.fetch({url:`http://127.0.0.1:4175${u.pathname}${u.search}`})});});
 await web.goto('http://lab.example.test/#twin');
 await expect(web.getByTestId('runtime-popover')).toBeVisible();await expect(web.locator('#twin-runtime-here')).toBeChecked();await expect(web.locator('#twin-runtime-url')).toHaveValue('http://127.0.0.1:4176');
 // its address field names what an address looks like, never "empty: this page's runtime" (this page has none)
 await expect(web.locator('label[for="twin-runtime-url"]')).toContainText('http://127.0.0.1:4176');await expect(web.locator('label[for="twin-runtime-url"]')).not.toContainText('để trống');
 await shot(web,'box-web-page-initial');await web.close();
 const page=await context.newPage();
 const box=page.getByTestId('runtime-popover'),url=page.locator('#twin-runtime-url');
 await page.goto('/#twin');
 // 1. this machine: chosen by default, the pinned commit and the runtime's (the page's own runtime answered the automatic probe) are shown
 await expect(box).toBeVisible();await expect(page.locator('#twin-runtime-here')).toBeChecked();
 await expect(box.getByTestId('runtime-pin-commit')).not.toHaveText('—');await expect(box.getByTestId('runtime-commit')).toHaveText(await box.getByTestId('runtime-pin-commit').textContent()??'');
 await shot(page,'box-this-machine');
 // 2. another address whose runtime runs another commit (a route stands in for it): pairing goes through, both commits are shown, no run can be created
 const cors={'Access-Control-Allow-Origin':'http://127.0.0.1:4175','Access-Control-Allow-Headers':'content-type, authorization','Access-Control-Allow-Methods':'GET, POST'};
 await page.route('https://rt.example/**',r=>{const path=new URL(r.request().url()).pathname;
  if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers:cors});
  if(path.endsWith('/sessions'))return r.fulfill({status:201,contentType:'application/json',headers:cors,body:JSON.stringify({sessionToken:'fake-session',principal:'p'})});
  return r.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify({protocolMajors:[2],sourceCommit:'b'.repeat(40),schemaHash:'s',scenarioIds:[],backends:[],backendSets:[],features:{bearer:true,pacedStep:true}})});});
 await page.locator('label',{hasText:'Địa chỉ khác'}).click();await url.fill('https://rt.example');await expect(page.locator('#twin-runtime-other')).toBeChecked();
 await page.locator('#twin-pair-token').fill('fake-code');await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(box.getByTestId('runtime-address')).toHaveText('https://rt.example');// paired
 await expect(box.getByTestId('runtime-pin-mismatch')).toContainText('bbbbbbb');await expect(box.getByTestId('runtime-pin-mismatch')).toContainText((await box.getByTestId('runtime-pin-commit').textContent())!);
 await shot(page,'box-pin-mismatch');
 await openInspector(page,'setup');await expect(page.locator('#inspector-panel-setup [data-action="twin-run"]')).toBeDisabled();
 await page.locator('[data-action="twin-inspector-toggle"]').click();
 if(!await box.isVisible())await page.getByTestId('runtime-chip').click();
 await expect(box).toBeVisible();await box.locator('[data-action="twin-disconnect"]').click();await expect(url).toHaveValue('https://rt.example');
 // 3. a loopback address the browser cannot reach: said once, in the box, with the whole checklist
 await url.fill('http://127.0.0.1:4179');await page.locator('#twin-pair-token').fill('not-used');await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(box.getByTestId('runtime-error')).toContainText('LOOPBACK_BLOCKED');await expect(box.getByTestId('runtime-error')).toContainText('Không tới được runtime trên máy này');
 await expect(box.getByTestId('runtime-error')).toContainText('--allow-origin http://127.0.0.1:4175');await expect(page.locator('.notice')).toHaveCount(0);
 await shot(page,'box-loopback-blocked');
 // back to this machine, then pair with the launcher's code
 await page.locator('label',{hasText:'Máy này'}).click();await expect(url).toHaveValue('');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(box).toBeHidden();

 await openScenarioPicker(page);await page.getByRole('button',{name:'MuJoCo · cà phê với tay máy xArm 6'}).click();
 await expect(page.locator('#twin-run-speed')).toHaveValue('1');// the preset starts at 1×
 const primary=page.getByTestId('primary-action');
 await expect(primary).toHaveText('Chạy MuJoCo (tay máy)',{timeout:180000});await expect(primary).toBeEnabled();
 await primary.click();
 await expect(page.getByTestId('mode-badge')).toHaveText('Mô phỏng · chưa hiệu chuẩn');await expect(page.getByTestId('mode-badge')).toHaveAttribute('data-mode','simulation');
 // identity: each backend with its own model; the run tag only as the mock parts' tag
 await openInspector(page,'engineering');const identity=page.getByTestId('run-identity');
 await expect(identity).toContainText('MJ-BV01');await expect(identity).toContainText('mujoco_arm@');await expect(identity).toContainText('thẻ mô hình của phần mock');await expect(identity).not.toContainText('model mock_kinematic');
 await shot(page,'engineering-identity');
 await page.locator('[data-action="twin-inspector-toggle"]').click();

 // the arm is drawn from its meshes once its first sample arrives; the preset opens on the arm cell
 const canvas=page.locator('#twin-stage canvas'),ds=(k:string)=>canvas.evaluate((c,key)=>(c as HTMLCanvasElement).dataset[key]??'',k);
 await expect.poll(()=>ds('armModel'),{timeout:60000}).toBe('mesh');expect(await ds('armMeshLinks')).toBe('14');expect(await ds('armFallback')).toBe('');
 // the view's framing, asked on demand (the canvas's twinFraming()); the canvas is looked up anew because a fresh mount replaces it
 type F={armFrac:number;floorInView:boolean;camera:string};
 const fr=()=>page.locator('#twin-stage canvas').evaluate(c=>(c as unknown as {twinFraming:()=>F}).twinFraming());
 await expect.poll(async()=>(await fr()).armFrac,{message:'the arm takes at least a third of the viewport height'}).toBeGreaterThanOrEqual(1/3);
 expect((await fr()).floorInView).toBe(false);
 const cell=(await fr()).camera,armFrac0=(await fr()).armFrac;
 const fit=page.locator('[data-action="twin-camera-fit"]'),home=page.locator('[data-action="twin-camera-home"]');
 await fit.click();await expect.poll(async()=>(await fr()).floorInView,{message:'one press of fit shows the whole floor'}).toBe(true);
 await home.click();await expect.poll(async()=>(await fr()).camera).toBe(cell);
 // the cell's supports are drawn with the arm, and the Display menu says what they are
 expect(await ds('armSupports')).toBe('2');expect(await ds('armIllustrative')).toBe('2');// the mount and a leg under the nozzle stand (the tray stands for the robot's: none)
 await openDisplayMenu(page);await expect(page.getByTestId('arm-cell-note')).toContainText('giả định');await expect(page.getByTestId('arm-cell-note')).toContainText('không có trong mô phỏng');await expect(page.getByTestId('arm-cell-note')).toContainText('khay ở nguyên chỗ khi robot rời đi');
 await page.locator('[data-action="twin-display-toggle"]').click();
 await expect.poll(()=>ds('cups'),{timeout:20000}).not.toBe('{}');await shot(page,'cell-start');
 // a fresh mount (2D, then 3D again): the same framing at the real viewport
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();await page.getByRole('button',{name:'3D',exact:true}).click();await page.locator('[data-action="twin-display-toggle"]').click();
 await expect.poll(()=>ds('armModel'),{timeout:20000}).toBe('mesh');
 await expect.poll(async()=>(await fr()).camera,{message:'a fresh mount frames the cell as home does'}).toBe(cell);
 const armFracFresh=(await fr()).armFrac;expect(armFracFresh).toBeGreaterThanOrEqual(1/3);expect(await ds('armSupports')).toBe('2');
 await shot(page,'cell-fresh-mount');

 // paced steps as the browser sees them: how long each took against its due time (20 ticks x 20 ms / factor)
 const steps:{factor:number;ms:number}[]=[];
 page.on('requestfinished',r=>{if(r.method()!=='POST'||!r.url().endsWith('/actions'))return;const b=r.postDataJSON() as {kind?:string;payload?:{pace?:{factor:number}}};if(b?.kind==='step'&&b.payload?.pace)steps.push({factor:b.payload.pace.factor,ms:r.timing().responseEnd});});
 const T=page.locator('#twin-transport'),btn=(a:string)=>T.locator(`[data-action="${a}"]`),status=page.getByTestId('run-status');
 const rebuilds0=await ds('rebuilds'),redraws0=await ds('redraws');
 const remember=()=>page.evaluate(()=>{(window as unknown as {kept:Element[]}).kept=[...document.querySelectorAll('#twin-transport button,#twin-run-speed,#twin-details [role="tab"],#twin-runtime-box button')];return (window as unknown as {kept:Element[]}).kept.length;});
 const allKept=()=>page.evaluate(()=>(window as unknown as {kept:Element[]}).kept.every(n=>n.isConnected));

 // 1× for 10 s
 const started=Date.now();
 await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();
 const s0=await simS(page),w0=Date.now();expect(await remember()).toBeGreaterThan(8);
 // the runtime box opened and closed with real clicks while steps land: in place, the controls keep their elements
 await page.waitForTimeout(2000);await page.getByTestId('runtime-chip').click();await expect(box).toBeVisible();await page.waitForTimeout(1000);
 await page.getByTestId('runtime-chip').click();await expect(box).toBeHidden();
 await page.waitForTimeout(Math.max(0,10000-(Date.now()-w0)));
 const s1=await simS(page),w1=Date.now(),measured=(s1-s0)/((w1-w0)/1000);
 expect(await allKept(),'controls kept their elements at 1×, the runtime box opened and closed').toBe(true);
 expect(measured,'1× runs at about real time').toBeGreaterThan(0.5);expect(measured).toBeLessThan(1.25);
 expect(await ds('plantCupsDropped')).toBe('0');expect(await ds('armSupports')).toBe('2');expect(await ds('armIllustrative')).toBe('2');
 // the user orbits during the run: the steps that land and the report refreshes keep the user's camera; home brings back the cell
 const cb=(await page.locator('#twin-stage canvas').boundingBox())!,[cx,cy]=[cb.x+cb.width/2,cb.y+cb.height/2];
 await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+160,cy+40,{steps:6});await page.mouse.up();
 const orbit=(await fr()).camera;expect(orbit).not.toBe(cell);const t0=await simS(page);
 await page.waitForTimeout(2500);expect(await simS(page)).toBeGreaterThan(t0);
 expect((await fr()).camera,'steps and report refreshes never reset a camera the user moved').toBe(orbit);
 await home.click();await expect.poll(async()=>(await fr()).camera).toBe(cell);
 // Pause with one real pointer click, then Resume
 await btn('twin-pause').click();await expect(status).toContainText('Tạm dừng');
 await btn('twin-resume').click();await expect(status).toContainText('Đang chạy');
 // on at 1× until the plant closes the gripper on a cup (the 3D view follows the plant)
 await btn('twin-play').click();await expect(btn('twin-stop')).toBeVisible();
 await expect.poll(async()=>Math.abs(Number(await ds('gripperRad'))),{timeout:120000,intervals:[200]}).toBeGreaterThan(0.01);
 const holding=JSON.parse(await ds('cups')||'{}') as Record<string,number[]>;
 await shot(page,'mujoco-1x-holding');
 // the same moment with the whole floor (fit, nothing selected), then back to the cell
 await fit.click();await expect.poll(async()=>(await fr()).floorInView).toBe(true);await shot(page,'mujoco-1x-holding-fit');await home.click();await expect.poll(async()=>(await fr()).camera).toBe(cell);
 // still at 1×: released, the cup rests on the tray (its centre 5 cm over the tray's top face at 0.76 m)
 await expect.poll(async()=>Object.values(JSON.parse(await ds('cups')||'{}') as Record<string,number[]>).some(p=>Math.abs(p[2]!-0.81)<0.01&&Math.hypot(p[0]!-3.016,p[1]!-1.016)<0.05),{timeout:120000,intervals:[200]}).toBe(true);
 await shot(page,'cup-on-tray-robot-docked');
 const rebuildsBeforeSelect=await ds('rebuilds');
 expect(rebuildsBeforeSelect,'the scene was not rebuilt while the run went on').toBe(rebuilds0);
 // both joint columns, labelled (selecting the arm is the user's change of the scene: one rebuild, counted apart)
 await openInspector(page,'objects');await page.getByTestId('entity-list').getByRole('button',{name:/Cánh tay 1/}).click();
 await openInspector(page,'engineering');
 const q1=page.getByTestId('eng-joint-1');await expect(q1.locator('dd').nth(0)).toContainText(/-?\d/);await expect(q1.locator('dd').nth(1)).toContainText(/-?\d/);
 await expect(page.getByTestId('eng-arm-source')).toContainText('thực (MuJoCo) · lệnh');
 await shot(page,'engineering-joints');
 const rebuildsSelected=await ds('rebuilds');
 // then 16× to completed
 await page.locator('#twin-run-speed').selectOption('16');
 await expect(status).toContainText('Hoàn thành',{timeout:600000});
 const total=(Date.now()-started)/1000;
 await expect(page.getByTestId('report-pending')).toHaveCount(0,{timeout:60000});
 const rebuilds1=await ds('rebuilds'),redraws1=await ds('redraws');
 await expect(page.getByTestId('run-served').locator('b')).toHaveText('2');
 await expect(page.getByTestId('problems-count')).toHaveCount(0);await expect(page.getByTestId('notes-count')).toHaveCount(0);
 expect(await ds('armModel')).toBe('mesh');expect(await ds('armFallback')).toBe('');expect(await ds('plantCupsDropped')).toBe('0');
 expect(rebuilds1,'the scene was not rebuilt while the run went on').toBe(rebuildsSelected);

 // the completed run with the details closed (the brief's screens/mujoco-coffee.png)
 await page.locator('[data-action="twin-inspector-toggle"]').click();await expect(page.getByTestId('twin-inspector')).toBeHidden();
 if(dir){mkdirSync(`${dir}/screens`,{recursive:true});await page.screenshot({path:`${dir}/screens/mujoco-coffee.png`});}
 // the robot has left the pickup for the table: the tray stays on its leg in the cell, as the simulated cell has it
 await shot(page,'cell-robot-left');

 // the report tab: the plant block
 await openInspector(page,'report');
 const plant=page.getByTestId('arm-plant');
 await expect(plant).toContainText('not_calibrated');await expect(plant).toContainText('contact');await expect(plant).toContainText('mujoco_3d');
 expect(await plant.getByTestId('arm-waypoints').locator('tbody tr').count()).toBeGreaterThan(0);
 await expect(plant.getByTestId('arm-allowed-contacts')).toContainText('toàn bộ vệt');await expect(plant.getByTestId('arm-release-timeout')).toContainText('giả định');
 await expect(plant.getByTestId('arm-scene-coverage')).toHaveAttribute('data-value','true');await expect(plant.getByTestId('arm-stop')).toHaveCount(0);
 await plant.scrollIntoViewIfNeeded();await shot(page,'report-plant');

 const id=(await page.evaluate(()=>document.querySelector('[data-testid="run-id"]')?.textContent??'')).trim();
 const r=await page.evaluate(async x=>(await fetch(`/lab/v2/runs/${x}/report`,{credentials:'same-origin'})).json(),id) as Report;
 expect(r.manifest.scenario.id).toBe('MJ-BV01');expect(r.manifest.backends.map(b=>b.id)).toContain('mujoco_arm');
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 expect(r.arm).toMatchObject({armPlant:{engine:'mujoco_3d',grip:'contact',calibration:'not_calibrated'},collision:{result:'pass'}});
 expect(r.coverage.armSceneCollision,'the docked robot was in the arm\'s collision check').toBe(true);
 // late: a step's round trip more than 250 ms past its due time (20 ticks x 20 ms / factor), the runtime's re-anchor threshold; lateness = round trip - due
 const due=(f:number)=>20*20/f,late=steps.filter(s=>s.ms>due(s.factor)+250),lateBy=(f:number)=>late.filter(s=>s.factor===f).length;
 const maxLateness=Math.round(Math.max(0,...steps.map(s=>s.ms-due(s.factor))));
 console.log(`MJ-BV01 ${JSON.stringify({measured1x:Number(measured.toFixed(3)),simS:[s0,s1],wallS:(w1-w0)/1000,totalWallS:Number(total.toFixed(1)),finalTick:r.outcome.tick,
  steps:steps.length,maxStepMs:{1:Math.max(0,...steps.filter(s=>s.factor===1).map(s=>Math.round(s.ms))),16:Math.max(0,...steps.filter(s=>s.factor===16).map(s=>Math.round(s.ms)))},late:late.length,late1x:lateBy(1),late16x:lateBy(16),maxLatenessMs:maxLateness,rebuilds:[rebuilds0,rebuildsBeforeSelect,rebuildsSelected,rebuilds1],armFrac:armFrac0,armFracFresh,redraws:[redraws0,redraws1],cupsWhileHolding:holding})}`);
 // I6: replay draws what was recorded: the arm from its meshes, and mid-pick a cup at the pose the plant recorded; a saved report reopened draws the same
 const rr=await page.evaluate(async x=>(await fetch(`/lab/v2/runs/${x}/report`,{credentials:'same-origin'})).json(),id) as {manifest:{clock:{tickMs:number}};telemetry:{samples:{entityId:string;providerId:string;frameId:string;simTimeNs:string;observed:{positionM?:number[]}|null}[]}};
 const cupSamples=rr.telemetry.samples.filter(s=>s.providerId==='mujoco_arm'&&s.frameId==='map'&&Array.isArray(s.observed?.positionM));
 expect(cupSamples.length,'the report records the plant\'s cup poses').toBeGreaterThan(0);
 const tickOf=(s:{simTimeNs:string})=>Number(s.simTimeNs)/1e6/rr.manifest.clock.tickMs,mid=cupSamples[cupSamples.length>>1]!,cursorTick=Math.ceil(tickOf(mid)/5)*5;
 const expected=cupSamples.filter(s=>tickOf(s)<=cursorTick&&s.entityId===mid.entityId).at(-1)!;
 const replayAt=async(name:string)=>{
  const cursor=page.locator('#twin-replay-cursor');await expect(cursor).toBeVisible();
  await expect.poll(()=>ds('armModel'),{timeout:20000}).toBe('mesh');expect(await ds('armSupports')).toBe('2');
  await cursor.fill(String(cursorTick));await expect(page.getByTestId('replay-time')).toContainText(`tick ${cursorTick}`);
  const want=expected.observed!.positionM!;
  await expect.poll(async()=>{const p=(JSON.parse(await ds('cups')||'{}') as Record<string,number[]>)[mid.entityId];return p?Math.max(...p.map((v,i)=>Math.abs(v-want[i]!))):Infinity;},{timeout:10000}).toBeLessThan(1e-3);
  if(dir)await page.screenshot({path:`${dir}/final-I6-${name}.png`});
 };
 await openInspector(page,'report');await page.getByRole('button',{name:'Xem lại (chỉ đọc)'}).click();
 await page.locator('[data-action="twin-inspector-toggle"]').click();
 await replayAt('replay-mid-pick');
 await openInspector(page,'report');await page.locator('[data-action="twin-save-evidence"]').click();
 await expect(page.locator('[data-action="twin-open-evidence"]')).not.toHaveCount(0);
 await page.locator('#twin-transport [data-action="twin-replay-exit"]').click();
 await page.locator('[data-action="twin-open-evidence"]').first().click();await expect(page.getByTestId('recorded-tag')).toBeVisible();
 await page.locator('[data-action="twin-inspector-toggle"]').click();
 await replayAt('saved-report-mid-pick');
 await context.close();
});
