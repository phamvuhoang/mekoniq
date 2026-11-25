// IR-SIM 2D vertical slice against the real pinned runtime, real IR-SIM worker and LinkForge (scripts/test-irsim-e2e.mjs, lab:irsim):
// load Serve -> compile -> validate -> 10-table world -> IR-FD01 -> scripted load/handoff confirmations -> pause/step -> report -> replay -> edit width -> stale -> rerun.
// Without the launcher's pairing code this FAILS (it is never skipped). Screenshots are candidate evidence only, never backend evidence.
import {test,expect,type Page} from '@playwright/test';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,shots=process.env.LAB_IRSIM_SCREENSHOTS;
const runId=async(page:Page)=>(await page.getByTestId('run-id').textContent())!.trim();
async function report(page:Page){const id=await runId(page);return page.evaluate(async r=>(await fetch(`/lab/v2/runs/${r}/report`,{credentials:'same-origin'})).json(),id) as Promise<{businessEvents:{type:string}[];confirmations:{confirmationType:string;provenance:string}[];navigation2d?:{engine:{id:string}};manifest:{backends:{id:string}[];scenario:{id:string}}}>;}
const locale=(page:Page,l:'VI'|'JA'|'EN')=>page.getByRole('button',{name:l,exact:true}).click();
async function capture(page:Page,name:string){
 if(!shots)return;
 for(const [size,viewport] of [['desktop',{width:1440,height:900}],['tablet',{width:820,height:1180}]] as const){
  await page.setViewportSize(viewport);
  for(const l of ['VI','JA','EN'] as const){await locale(page,l);await page.screenshot({path:`${shots}/irsim-${name}-${size}-${l.toLowerCase()}.png`,fullPage:true});}
 }
 await page.setViewportSize({width:1440,height:900});await locale(page,'EN');
}
async function compileAndValidate(page:Page){
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 await expect(page.getByTestId('asm-receipt')).not.toContainText('stale');
 await page.getByRole('button',{name:'Validate model · amr-1'}).click();
 const v=page.getByTestId('model-validation');
 await expect(v).toHaveAttribute('data-state','current',{timeout:120000});
 // LinkForge really ran on this bundle: a pass, with its engine identity (never a not_run shown as pass)
 await expect(v).toHaveAttribute('data-tone','ok');await expect(v).toContainText('linkforge');
 return (await page.getByTestId('validation-digest').textContent())!.trim();
}

test('Serve on IR-SIM 2D: validate, run IR-FD01 to completion, report and replay, then a width edit makes everything stale until it is rerun',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs: it starts lab:irsim with the real worker and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(600000);
 const context=await browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),page=await context.newPage();
 await page.goto('/#twin');await locale(page,'EN');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 // the IR set is offered because health says irsim_2d is live; mock and native sets are still listed
 const sets=page.locator('#twin-backend-set option');
 await expect(page.locator('#twin-backend-set option[value="engineering-irsim-2d-v1"]')).toBeEnabled();
 await expect(sets.filter({hasText:'mock-amr'})).toHaveCount(1);await expect(sets.filter({hasText:'coffee-simulation'})).toHaveCount(1);

 // Assembly: load Serve, compile with the portable profile, validate the model
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open Serve robot (IR-SIM 2D)'}).click();
 await expect(page.getByTestId('asm-meta')).toContainText('engineering-irsim-2d-v1');
 const firstReport=await compileAndValidate(page);
 await capture(page,'assembly-validated');

 // Twin: the 10-table world and IR-FD01
 await page.goto('/#twin');
 await openScenarioPicker(page);await page.getByRole('button',{name:'IR-SIM 2D · FD01 delivery'}).click();
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();
 await expect(page.locator('#twin-scene-title')).toContainText('20 × 12 m');
 for(const t of ['T01','T10'])await expect(page.getByTestId('twin-scene')).toContainText(t);
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Compiled bundle for this exact draft'})).toHaveClass(/ok/);
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Runtime readiness'})).toHaveClass(/ok/,{timeout:30000});
 await page.getByRole('button',{name:'Run IR-SIM 2D'}).click();
 await expect(page.getByTestId('mode-badge')).toHaveText('Simulation · not calibrated');/* the page is in English here */await expect(page.getByTestId('mode-badge')).toHaveAttribute('data-mode','simulation');
 await expect(page.getByTestId('run-identity')).toContainText('IR-FD01');
 // layers with provenance: compiled footprint and obstacles, safety envelope; LiDAR says why it is not drawn on a live run
 await expect(page.getByTestId('layer-provenance')).toContainText('drive → base');
 await expect(page.locator('.tw-compiled-obstacle').first()).toBeAttached();
 await expect(page.locator('polygon[data-layer="footprint"]')).toHaveCount(1);
 await openDisplayMenu(page);await page.getByRole('button',{name:'Safety envelope'}).click();await expect(page.locator('polygon[data-layer="safety"]')).toHaveCount(1);
 await page.getByRole('button',{name:'LiDAR',exact:true}).click();await expect(page.getByTestId('scan-unavailable')).toContainText('SCAN_STREAM_NOT_EXPOSED');

 // pause is acknowledged by the backend; no step while paused (the set has manualStep:false); resume, then a step advances the run
 await page.getByRole('button',{name:'Pause simulation'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Paused');
 await expect(page.getByRole('button',{name:'+5 s'})).toBeDisabled();
 await page.getByTestId('twin-transport').getByRole('button',{name:'Resume simulation'}).click();// the primary action resumes too (item 2)
 await expect(page.getByTestId('run-status')).not.toContainText('Paused');
 const tick=await page.getByTestId('run-tick').textContent();
 await page.getByRole('button',{name:'+5 s'}).click();
 await expect(page.getByTestId('run-tick')).not.toHaveText(tick!);
 await page.locator('#twin-run-speed').selectOption('64');
 await openDisplayMenu(page);await page.getByRole('button',{name:'Observed path'}).click();
 await page.getByRole('button',{name:'Auto-run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:420000});

 // load and handoff were confirmed (scripted actor, never claimed as a human), the run used the IR-SIM plant
 const r=await report(page);
 expect(r.manifest.scenario.id).toBe('IR-FD01');expect(r.manifest.backends.map(b=>b.id)).toEqual(['irsim_2d']);expect(r.navigation2d?.engine.id).toBe('irsim_2d');
 expect(r.businessEvents.map(e=>e.type)).toEqual(expect.arrayContaining(['CargoLoaded','DeliveryHandedOff']));
 expect(r.confirmations.length).toBeGreaterThanOrEqual(2);expect(r.confirmations.every(c=>c.provenance==='scripted')).toBe(true);

 // report: provider and completeness from the evidence itself
 const nav=page.getByTestId('navigation-evidence');
 await expect(nav).toHaveAttribute('data-supported','true');await expect(nav).toContainText('irsim_2d');
 await expect(nav).toHaveAttribute('data-complete','true',{timeout:30000});
 await expect(page.getByTestId('navigation-assertions').locator('tr')).not.toHaveCount(0);
 await expect(page.locator('polyline[data-layer="observed"]').first()).toBeAttached();
 await openInspector(page,'report');await page.getByRole('button',{name:'Save immutable report'}).click();
 await expect(page.getByTestId('evidence-status').first()).toContainText('inputs match');
 await capture(page,'twin-completed');

 // replay: read-only, no action request
 let actions=0;page.on('request',q=>{if(q.method()==='POST'&&/\/actions$/.test(q.url()))actions++;});
 await page.getByRole('button',{name:'Replay (read-only)'}).click();
 await page.locator('#twin-replay-cursor').fill('500');
 await expect(page.getByTestId('replay-time')).toContainText('tick 500');
 await expect(page.getByTestId('replay-entities')).toContainText('amr-1');
 // review7 #3: the evidence verdict is the whole run's at every cursor
 await expect(nav).toHaveAttribute('data-complete','true');await expect(nav).not.toContainText('IDENTITY_MISMATCH');
 await capture(page,'twin-replay');
 await page.getByRole('button',{name:'Exit replay'}).click();
 expect(actions).toBe(0);
 const firstRun=await runId(page);

 // edit the world width on the Assembly page: the receipt and the validation are stale, and the twin refuses the old bundle for the new draft
 await page.goto('/#assembly');
 await page.locator('#asm-world-width').fill('21');await page.locator('#asm-world-width').dispatchEvent('change');
 await expect(page.getByTestId('model-validation')).toHaveAttribute('data-state','stale');
 await expect(page.getByTestId('asm-receipt')).toContainText('stale');
 await page.goto('/#twin');
 // the saved report no longer applies to the edited design (assembly digest and world changed); it stays unchanged itself
 await expect(page.getByTestId('evidence-status').first()).toContainText('stale evidence');
 await expect(page.getByTestId('evidence-status').first()).toContainText('assembly');

 // rerun: compile and validate the edited draft, then a new run from it
 await page.goto('/#assembly');
 const secondReport=await compileAndValidate(page);
 expect(secondReport).not.toBe(firstReport);
 await page.goto('/#twin');
 await openInspector(page,'setup');await page.getByRole('button',{name:'Run with edited inputs'}).click();// create re-checks readiness against the new bundle before any run
 await expect(page.getByTestId('run-id')).not.toHaveText(firstRun,{timeout:60000});
 await expect(page.locator('#twin-scene-title')).toContainText('21 × 12 m');
 await expect(page.getByTestId('run-status')).toContainText(/Running|Awaiting/);
 await page.getByRole('button',{name:'Cancel run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Cancelled',{timeout:60000});
 await context.close();
});
