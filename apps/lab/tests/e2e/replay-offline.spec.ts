import {test,expect} from '../support/replay-preview';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const out=process.env.LAB_B07B_EVIDENCE;
const seek=async(page:import('@playwright/test').Page,tick:number)=>{await page.locator('#replay-cursor').evaluate((el:HTMLInputElement,t)=>{el.value=String(t);el.dispatchEvent(new Event('input',{bubbles:true}));},tick);await expect(page.locator('#replay-time')).toContainText(`tick ${tick}/`);};
test('offline first initialization sends no runtime transport; fixed aliases preserve stored package bytes',async({page})=>{
 test.setTimeout(120000);await page.addInitScript(()=>{const denied:string[]=[];(window as unknown as {__runtimeTransports:string[]}).__runtimeTransports=denied;for(const name of ['EventSource','WebSocket'])Object.defineProperty(window,name,{configurable:true,value:class{constructor(url:string){denied.push(name+':'+url);throw Error('OFFLINE_TRANSPORT_DENIED');}}});});const attempts:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/lab/**',r=>{attempts.push(r.request().url());return r.abort();});await page.goto('/#replay/external-impact');await expect(page.locator('#replay-cursor')).toBeVisible({timeout:60000});await page.getByRole('button',{name:'EN',exact:true}).click();await expect(page.locator('#replay-cursor')).toHaveAttribute('step','1');const range=await page.locator('#replay-cursor').elementHandle();await page.locator('#replay-cursor').focus();await seek(page,2375);expect(await range!.evaluate(e=>e===document.activeElement)).toBe(true);await expect(page.locator('#replay-issues')).toContainText('LOAD_FELL');await expect(page.locator('#replay-facts')).toContainText('Applied worker disturbance receipt');await seek(page,0);await expect(page.locator('#replay-issues')).not.toContainText('LOAD_FELL');await expect(page.locator('#replay-facts')).toContainText('CAPTURE_HORIZON_ONLY');
 const checked=await page.evaluate(async()=>{const m=await(await fetch('/replays/external-impact/manifest.json')).json(),a=m.assets.find((a:{encoding:string})=>a.encoding==='gzip'),r=await fetch('/replays/external-impact/'+a.path+'.bin'),b=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(n=>n.toString(16).padStart(2,'0')).join('');return {actual:b.byteLength,expected:a.bytes,hash,expectedHash:a.sha256,encoding:r.headers.get('Content-Encoding')};});expect(checked.actual).toBe(checked.expected);expect(checked.hash).toBe(checked.expectedHash);expect(checked.encoding).not.toBe('gzip');
 const download=page.waitForEvent('download');await page.locator('.replay-files>summary').click();await page.locator('[data-replay="export"]').click();const zip=await download;if(out)await zip.saveAs(join(out,'offline-roundtrip.zip'));expect(zip.suggestedFilename()).toMatch(/\.zip$/);expect(attempts).toEqual([]);expect(await page.evaluate(()=>(window as unknown as {__runtimeTransports:string[]}).__runtimeTransports)).toEqual([]);expect(errors).toEqual([]);
});
test('replace and cancel own loads; folder import works with runtime requests denied',async({page})=>{
 test.setTimeout(90000);const attempts:string[]=[];await page.route('**/lab/**',r=>{attempts.push(r.request().url());return r.abort();});await page.goto('/#replay');await expect(page.locator('#replay-story')).toBeVisible();await page.selectOption('#replay-story','coffee-delivery');await page.locator('.replay-files>summary').click();await page.locator('[data-replay="cancel"]').click();await expect(page.locator('#replay-cursor')).toHaveCount(0);await page.locator('.replay-files>summary').click();await page.locator('#replay-import').setInputFiles(join(process.cwd(),'public/replays/external-impact'));await expect(page.locator('#replay-cursor')).toBeVisible({timeout:60000});await seek(page,2375);expect(attempts).toEqual([]);
 if(out){const m=JSON.parse(readFileSync('public/replays/external-impact/manifest.json','utf8'));await page.screenshot({path:join(out,'offline-import-terminal.png')});expect(m.horizon.tick).toBe(2375);}
});

test('rapid cursor work coalesces and object focus has a single-action Overview reset',async({page})=>{
 test.setTimeout(90000);await page.goto('/#replay/external-impact');await expect(page.locator('#replay-cursor')).toBeVisible({timeout:60000});let reads=0;page.on('request',r=>{if(/\/world\/chunk-.*\.bin$/.test(r.url()))reads++;});
 await page.locator('#replay-cursor').evaluate((input:HTMLInputElement)=>{for(let i=0;i<200;i++){input.value=String(i);input.dispatchEvent(new Event('input',{bubbles:true}));}input.value='2375';input.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#replay-time')).toContainText('2375/2375');expect(reads).toBeLessThanOrEqual(3);
 await page.locator('.replay-files>summary').click();await page.selectOption('#replay-object','cup-1');await page.locator('.replay-files>summary').click();await expect(page.locator('#replay-camera')).toHaveValue('custom');await page.locator('[data-replay="camera-reset"]').click();await expect(page.locator('#replay-camera')).toHaveValue('overview');
});

test('drive-fault sample: opens with every runtime request denied, its manifest hash is the catalog\'s, the fault section reads and its row moves the recorded cursor to the applied tick',async({page},testInfo)=>{
 test.setTimeout(120000);const attempts:string[]=[];await page.route('**/lab/**',r=>{attempts.push(r.request().url());return r.abort();});
 await page.goto('/#replay');
 const checked=await page.evaluate(async()=>{const c=await(await fetch('/replays/catalog.json')).json(),e=c.replays.find((r:{id:string})=>r.id==='drive-fault'),bytes=await(await fetch('/replays/drive-fault/manifest.json')).arrayBuffer(),h=await crypto.subtle.digest('SHA-256',bytes);return {entry:e,sha:[...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,'0')).join('')};});
 expect(checked.entry.manifestSha256).toBe(checked.sha);expect(checked.entry.provenance).toContain('accepted:false');expect(checked.entry.provenance).toContain('not_calibrated');expect(checked.entry.title).toHaveLength(3);
 await page.goto('/#replay/drive-fault');await expect(page.locator('#replay-cursor')).toBeVisible({timeout:90000});
 const section=page.locator('#replay-faults').getByTestId('fault-evidence');await expect(section).toHaveAttribute('data-available','true');
 const row=section.locator('tr[data-verdict]').first();await expect(row).toHaveAttribute('data-verdict','detected_in_time');await expect(row).toContainText('drive-trip');await expect(row).toContainText('amr-1/wheel-right');await expect(row).toContainText('tick 2401');
 await row.locator('[data-action="twin-fault-jump"]').click();await expect(page.locator('#replay-cursor')).toHaveValue('2401',{timeout:30000});await expect(page.locator('#replay-time')).toContainText('tick 2401');
 expect(attempts).toEqual([]);
 await testInfo.attach('r4-offline-replay',{body:Buffer.from(JSON.stringify({sampleId:'drive-fault',runId:checked.entry.recording,manifestSha256:checked.sha,cursorTick:2401,runtimeRequests:attempts})),contentType:'application/json'});
 // an older sample says nothing about faults: no section, and no table of zeros
 await page.goto('/#replay/external-impact');await expect(page.locator('#replay-cursor')).toBeVisible({timeout:90000});await expect(page.locator('#replay-faults [data-testid="fault-evidence"]')).toHaveCount(0);
});

test('belief-recovery sample: the offline recovery row seeks to its recorded world pose',async({page,baseURL},testInfo)=>{
 test.setTimeout(180000);
 const sampleId='belief-recovery',root=join(process.cwd(),'public/replays',sampleId),attempts:string[]=[];
 await page.addInitScript(()=>{
  const denied:string[]=[];Object.assign(window,{__runtimeTransports:denied});
  for(const name of ['EventSource','WebSocket'])Object.defineProperty(window,name,{configurable:true,value:class{constructor(url:string){denied.push(name+':'+url);throw Error('OFFLINE_TRANSPORT_DENIED');}}});
 });
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.protocol.startsWith('http')&&(url.origin!==new URL(baseURL!).origin||/^\/lab(?:\/|$)/.test(url.pathname))){attempts.push(url.href);return route.abort();}
  return route.continue();
 });
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.goto('/#replay/'+sampleId);
 const manifestBytes=readFileSync(join(root,'manifest.json')),manifest=JSON.parse(manifestBytes.toString()),manifestSha256=createHash('sha256').update(manifestBytes).digest('hex');
 const catalog=await (await page.request.get('/replays/catalog.json')).json(),entry=catalog.replays.find((e:{id:string})=>e.id===sampleId);
 const served=await (await page.request.get('/replays/'+sampleId+'/manifest.json')).body();expect(served.equals(manifestBytes)).toBe(true);
 expect(entry).toMatchObject({recording:manifest.runId,horizon:manifest.horizon.tick,manifestSha256});
 for(const label of ['not_calibrated','accepted:false','display_only_not_requalification'])expect(entry.provenance).toContain(label);
 const decoded=(path:string)=>{
  const a=manifest.assets.find((a:{path:string})=>a.path===path),bytes=readFileSync(join(root,path+(a.encoding==='gzip'?'.bin':'')));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.sha256);
  return (a.encoding==='gzip'?gunzipSync(bytes):bytes).toString();
 };
 const report=JSON.parse(decoded(manifest.assets.find((a:{role:string})=>a.role==='report').path));
 const step=report.perceptionEvidence.recovery.find((r:{action:string;result:string})=>r.action==='open_gripper'&&r.result==='done');expect(step).toBeTruthy();
 const tick:number=step.recordedTick;
 let xy:number[]|undefined;
 for(const path of manifest.streams.find((s:{kind:string})=>s.kind==='world').chunks){
  const world=decoded(path).trim().split('\n').map(line=>JSON.parse(line)).find(r=>r.snapshot.tick===tick);
  if(world){xy=world.snapshot.props.find((p:{propId:string})=>p.propId==='cup-1').position;break;}
 }
 expect(xy).toBeDefined();const maxY=JSON.parse(decoded('bundle/lab-world-scene.json')).controllerPolicy.bounds.maxM[1];
 await expect(page.locator('#replay-cursor')).toBeVisible({timeout:100000});
 const observation=report.perceptionEvidence.beliefs.find((b:{objectId:string;tick:number;belief?:{valid:boolean}})=>b.objectId==='cup-1'&&b.tick>=1400&&b.belief?.valid);
 expect(observation).toBeDefined();await seek(page,observation.tick);
 await expect(page.getByTestId('belief-legend')).toHaveAttribute('data-state','data');
 await seek(page,manifest.horizon.tick);
 for(const [i,lang] of ['VI','JA','EN'].entries()){
  await page.getByRole('button',{name:lang,exact:true}).click();
  await expect(page.locator('#replay-story option:checked')).toHaveText(entry.title[i]);
  await expect(page.getByTestId('perception-recovery').locator('li[data-result="done"] button')).toHaveCount(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1)).toBe(true);
 }
 const table=page.getByTestId('perception-attempts');
 await expect(table.locator('[data-attempt="cup-1#0"] [data-outcome]')).toHaveAttribute('data-outcome','grip_not_established');
 await expect(table.locator('[data-attempt="cup-1#1"] [data-outcome]')).toHaveAttribute('data-outcome','lifted');
 const jump=page.getByTestId('perception-recovery').locator('li[data-step="'+step.stepId+'"] button');
 await expect(jump).toContainText(String(tick));await jump.click();await expect(page.locator('#replay-time')).toContainText('tick '+tick+'/');
 const to2d=page.getByRole('button',{name:'2D',exact:true});if(await to2d.count())await to2d.click();
 await expect(page.locator('#replay-stage [data-entity="cup-1"]')).toHaveAttribute('transform',`translate(${(xy![0]!*100).toFixed(1)},${((maxY-xy![1]!)*100).toFixed(1)})`);
 await testInfo.attach('recovery-cursor-390px',{body:await page.screenshot(),contentType:'image/png'});
 const runtimeRequests=[...attempts,...await page.evaluate(()=>(window as unknown as {__runtimeTransports:string[]}).__runtimeTransports)];
 expect(runtimeRequests).toEqual([]);
 await testInfo.attach('r4-offline-replay',{body:Buffer.from(JSON.stringify({sampleId,runId:manifest.runId,manifestSha256,cursorTick:tick,runtimeRequests})),contentType:'application/json'});
});
