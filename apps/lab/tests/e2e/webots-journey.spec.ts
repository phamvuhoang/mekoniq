// Webots 3D vertical slice against the real pinned runtime and the real Webots R2025a (scripts/test-irsim-e2e.mjs --provider webots, lab:webots):
// load the Serve robot with casters -> compile -> 10-table world -> WB-FD01 -> pause/step -> scripted load/handoff -> report -> replay in the 3D twin -> three languages.
// Without the launcher's pairing code this FAILS (it is never skipped). Screenshots are candidate evidence only, never backend evidence.
import {test,expect,type Page} from '@playwright/test';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_IRSIM_SCREENSHOTS;
const runId=async(page:Page)=>(await page.getByTestId('run-id').textContent())!.trim();
interface Report {businessEvents:{type:string}[];confirmations:{confirmationType:string;provenance:string}[];manifest:{scenario:{id:string};backends:{id:string}[]};limitations:string[];coverage:{dynamics:boolean};
 navigation2d?:{engine:{id:string;engineVersion?:string};completeness?:{status:string};seed:{engineSeedAlgorithm:string}}}
async function report(page:Page){const id=await runId(page);return page.evaluate(async r=>(await fetch(`/lab/v2/runs/${r}/report`,{credentials:'same-origin'})).json(),id) as Promise<Report>;}
const locale=(page:Page,l:'VI'|'JA'|'EN')=>page.getByRole('button',{name:l,exact:true}).click();
async function capture(page:Page,name:string){
 if(!shots)return;
 for(const [size,viewport] of [['desktop',{width:1440,height:900}],['tablet',{width:820,height:1180}]] as const){
  await page.setViewportSize(viewport);
  for(const l of ['VI','JA','EN'] as const){await locale(page,l);await page.screenshot({path:`${shots}/webots-${name}-${size}-${l.toLowerCase()}.png`,fullPage:true});}
 }
 await page.setViewportSize({width:1440,height:900});await locale(page,'EN');
}

test('Serve on Webots 3D: compile, run WB-FD01 to completion, report and replay in the 3D twin, in three languages',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider webots: it starts lab:webots with the real Webots and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(900000);
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),page=await context.newPage();
 await page.goto('/#twin');await locale(page,'EN');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 // the Webots set is offered because health says webots_3d is live; the IR-SIM set is listed but locked, mock and native sets are still listed
 await expect(page.locator('#twin-backend-set option[value="engineering-webots-3d-v1"]')).toBeEnabled();
 await expect(page.locator('#twin-backend-set option[value="engineering-irsim-2d-v1"]')).toHaveJSProperty('disabled',true);
 await expect(page.locator('#twin-backend-set option').filter({hasText:'mock-amr'})).toHaveCount(1);

 // Assembly: the Serve robot with casters, compiled with the Webots profile
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open Serve robot (Webots 3D)'}).click();
 await expect(page.getByTestId('asm-meta')).toContainText('engineering-webots-3d-v1');
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 await expect(page.getByTestId('asm-receipt')).not.toContainText('stale');
 await capture(page,'assembly-compiled');

 // Twin: the 10-table world and WB-FD01
 await page.goto('/#twin');
 await openScenarioPicker(page);await page.getByRole('button',{name:'Webots 3D · FD01 delivery'}).click();
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();
 await expect(page.locator('#twin-scene-title')).toContainText('20 × 12 m');
 for(const t of ['T01','T10'])await expect(page.getByTestId('twin-scene')).toContainText(t);
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Compiled bundle for this exact draft'})).toHaveClass(/ok/);
 // polled with its text: a readiness that never becomes ok fails with the runtime's own reasons
 await expect.poll(async()=>{const li=page.getByTestId('preflight').locator('li',{hasText:'Runtime readiness'});return await li.getAttribute('class')==='ok'?'ok':await li.innerText();},{timeout:120000,intervals:[1000]}).toBe('ok');
 await page.getByRole('button',{name:'Run Webots 3D'}).click();
 await expect(page.getByTestId('mode-badge')).toHaveText('Simulation · not calibrated');/* the page is in English here */await expect(page.getByTestId('mode-badge')).toHaveAttribute('data-mode','simulation');
 await expect(page.getByTestId('run-identity')).toContainText('WB-FD01');
 await expect(page.locator('polygon[data-layer="footprint"]')).toHaveCount(1);

 // pause is acknowledged; no step while paused; resume, then a step advances the run
 await page.getByRole('button',{name:'Pause simulation'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Paused');
 await expect(page.getByRole('button',{name:'+5 s'})).toBeDisabled();
 await page.getByTestId('twin-transport').getByRole('button',{name:'Resume simulation'}).click();// the primary action resumes too (item 2)
 await expect(page.getByTestId('run-status')).not.toContainText('Paused');
 const tick=await page.getByTestId('run-tick').textContent();
 await page.getByRole('button',{name:'+5 s'}).click();
 await expect(page.getByTestId('run-tick')).not.toHaveText(tick!);
 await page.locator('#twin-run-speed').selectOption('64');
 await page.getByRole('button',{name:'Auto-run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:600000});

 // the run used the Webots plant; its identity and its honesty about calibration are in the report itself
 const r=await report(page);
 expect(r.manifest.scenario.id).toBe('WB-FD01');expect(r.manifest.backends.map(b=>b.id)).toEqual(['webots_3d']);
 expect(r.navigation2d).toMatchObject({engine:{id:'webots_3d',engineVersion:'R2025a'},seed:{engineSeedAlgorithm:'webots-worldinfo-seed-v1'}});
 expect(r.coverage.dynamics).toBe(true);expect(r.limitations.join(' ')).toContain('not_calibrated');
 expect(r.businessEvents.map(e=>e.type)).toEqual(expect.arrayContaining(['CargoLoaded','DeliveryHandedOff']));
 expect(r.confirmations.length).toBeGreaterThanOrEqual(2);expect(r.confirmations.every(c=>c.provenance==='scripted')).toBe(true);
 const nav=page.getByTestId('navigation-evidence');
 await expect(nav).toHaveAttribute('data-supported','true');await expect(nav).toContainText('webots_3d');await expect(nav).toContainText('Webots R2025a');await expect(nav).not.toContainText('IR-SIM');
 await expect(nav).toHaveAttribute('data-complete','true',{timeout:30000});
 await expect(page.getByTestId('navigation-assertions').locator('tr')).not.toHaveCount(0);
 await openInspector(page,'report');await page.getByRole('button',{name:'Save immutable report'}).click();
 await expect(page.getByTestId('evidence-status').first()).toContainText('inputs match');
 await capture(page,'twin-completed');

 // replay in the 3D twin: read-only, no action request, the cursor lands on a recorded tick
 let actions=0;page.on('request',q=>{if(q.method()==='POST'&&/\/actions$/.test(q.url()))actions++;});
 await page.getByRole('button',{name:'Replay (read-only)'}).click();
 await page.locator('#twin-replay-cursor').fill('500');
 await expect(page.getByTestId('replay-time')).toContainText('tick 500');
 await expect(page.getByTestId('replay-entities')).toContainText('amr-1');
 await openDisplayMenu(page);await page.getByRole('button',{name:'3D',exact:true}).click();
 await expect(page.locator('canvas[aria-label^="3D twin view"]')).toBeVisible();
 await expect(nav).toHaveAttribute('data-complete','true');await expect(nav).not.toContainText('IDENTITY_MISMATCH');
 await capture(page,'twin-replay-3d');
 await page.getByRole('button',{name:'Exit replay'}).click();
 expect(actions).toBe(0);
 await context.close();
});
