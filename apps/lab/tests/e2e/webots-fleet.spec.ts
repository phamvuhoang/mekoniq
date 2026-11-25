// Two-robot journey against the real pinned runtime and the real Webots R2025a (scripts/test-irsim-e2e.mjs --provider webots -- webots-fleet.spec.ts): open the two-robot Serve
// fleet with casters, compile, run WB-FD07 to completion, then read the report. Both robots deliver through the source, one at a time (the venue-movement reservation
// serialises them); the aisle zone is server-side only. Every metric read comes from the durable trace (navigation2d), never from the animation. Never skipped.
import {test,expect} from '@playwright/test';
import {openDisplayMenu,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
interface Report {manifest:{scenario:{id:string};backends:{id:string}[]};outcome:{status:string;served:string;tick:number};entities:{id:string}[];businessEvents:{type:string;kind:string;state:Record<string,unknown>}[];
 metrics:{maxConcurrentMovers:number;collision:{available:boolean;contacts:number|null};navigation?:{coverage:string;distanceM:Record<string,number>|null;collisionEpisodes:number|null}};navigation2d?:{engine:{id:string};completeness?:{status:string}}}

test('Two Serve robots on Webots 3D: compile the fleet, run WB-FD07 to completion, and read trace-derived metrics for both robots',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider webots -- webots-fleet.spec.ts: it starts lab:webots with the real Webots and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(900000);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open two-robot Serve fleet (Webots 3D)'}).click();
 await expect(page.getByTestId('asm-meta')).toContainText('engineering-webots-3d-v1');
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 await page.goto('/#twin');
 await openScenarioPicker(page);await page.getByRole('button',{name:'Webots 3D · two robots FD07'}).click();
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Compiled bundle for this exact draft'})).toHaveClass(/ok/);
 // polled with its text: a readiness that never becomes ok fails with the runtime's own reasons
 await expect.poll(async()=>{const li=page.getByTestId('preflight').locator('li',{hasText:'Runtime readiness'});return await li.getAttribute('class')==='ok'?'ok':await li.innerText();},{timeout:120000,intervals:[1000]}).toBe('ok');
 await page.getByRole('button',{name:'Run Webots 3D'}).click();
 await expect(page.getByTestId('run-identity')).toContainText('WB-FD07');
 await expect(page.locator('polygon[data-layer="footprint"]')).toHaveCount(2);
 await page.locator('#twin-run-speed').selectOption('64');
 await page.getByRole('button',{name:'Auto-run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:600000});
 const runId=(await page.getByTestId('run-id').textContent())!.trim();
 const r=await page.evaluate(async id=>(await fetch(`/lab/v2/runs/${id}/report`,{credentials:'same-origin'})).json(),runId) as Report;
 await expect(page.locator('#preset-webots-fd07-summary')).toContainText('server-side only');
 expect(r.metrics.maxConcurrentMovers).toBe(1);
 expect(r.manifest.scenario.id).toBe('WB-FD07');expect(r.manifest.backends.map(b=>b.id)).toEqual(['webots_3d']);expect(r.navigation2d?.engine.id).toBe('webots_3d');
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});expect(r.outcome.tick).toBeLessThanOrEqual(12000);
 expect(r.entities.map(e=>e.id).sort()).toEqual(['robot01','robot02']);
 const zone=r.businessEvents.filter(e=>e.kind==='reservation'&&e.state.zoneId==='aisle-west');
 for(const id of ['robot01','robot02']){expect(zone.some(e=>e.type==='ZoneReservationGranted'&&e.state.robotId===id),`${id} granted`).toBe(true);expect(zone.some(e=>e.type==='ZoneReservationReleased'&&e.state.robotId===id),`${id} released`).toBe(true);}
 const nav=r.metrics.navigation!;
 expect(r.navigation2d!.completeness!.status).toBe('complete');expect(nav.coverage).toBe('complete');
 expect(nav.distanceM!.robot01).toBeGreaterThan(5);expect(nav.distanceM!.robot02).toBeGreaterThan(5);
 expect(r.metrics.collision).toMatchObject({available:true,contacts:0});expect(nav.collisionEpisodes).toBe(0);
 const panel=page.getByTestId('navigation-evidence');
 await expect(panel).toHaveAttribute('data-supported','true');await expect(panel).toHaveAttribute('data-complete','true',{timeout:30000});
 await context.close();
});
