// C02 two-robot journey against the real pinned runtime and the real IR-SIM worker (scripts/test-irsim-e2e.mjs, lab:irsim): open the two-robot Serve fleet,
// compile, run IR-FD07 to completion, then read the report. What this proves: robot01 and robot02 (their own wheels and LiDARs) both deliver through the source,
// one at a time (the venue-movement reservation serializes them); the aisle zone is reserved and released per leg (never contended in this scenario) and a customer
// walks away from both routes. The zone and the customer are server-side only and not drawn by the Lab. Zone contention is proven by the source campaign's
// contention rig (IR-RIG-ZONE), not here. Every metric read comes from the durable trace (navigation2d), never from the animation.
// Without the launcher's pairing code this FAILS (never skipped).
import {test,expect} from '@playwright/test';
import {openDisplayMenu,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
interface Report {manifest:{scenario:{id:string};backends:{id:string}[];models:{id:string;hash:string}[]};outcome:{status:string;served:string;tick:number};
 entities:{id:string}[];businessEvents:{type:string;kind:string;state:Record<string,unknown>}[];
 metrics:{maxConcurrentMovers:number;distanceM:Record<string,number>;collision:{available:boolean;contacts:number|null;minSeparationM:number|null};navigation?:{coverage:string;horizon:number|null;collisionEpisodes:number|null;minSeparationM:number|null;distanceM:Record<string,number>|null;sensorPublications:{expected:number;recorded:number;complete:boolean}}};
 navigation2d?:{engine:{id:string};completeness?:{status:string};modelDigests:string[];clock:{tickHorizon:number}}}

test('Two Serve robots on IR-SIM 2D: compile the fleet, run IR-FD07 to completion, and read trace-derived metrics for both robots',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs -- irsim-fleet.spec.ts: it starts lab:irsim with the real worker and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(900000);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');

 // Assembly: the fleet design (two entities, two drive bindings), compiled by the portable profile on the runtime
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open two-robot Serve fleet (IR-SIM 2D)'}).click();
 await expect(page.getByTestId('asm-meta')).toContainText('engineering-irsim-2d-v1');
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 for(const id of ['robot01','robot02'])await expect(page.getByRole('button',{name:`Validate model · ${id}`})).toBeVisible();

 // Twin: IR-FD07 on the fleet; both footprints drawn from the compiled scene
 await page.goto('/#twin');
 await openScenarioPicker(page);await page.getByRole('button',{name:'IR-SIM 2D · two robots FD07'}).click();
 await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Compiled bundle for this exact draft'})).toHaveClass(/ok/);
 await expect(page.getByTestId('preflight').locator('li',{hasText:'Runtime readiness'})).toHaveClass(/ok/,{timeout:30000});
 await page.getByRole('button',{name:'Run IR-SIM 2D'}).click();
 await expect(page.getByTestId('run-identity')).toContainText('IR-FD07');
 await expect(page.locator('polygon[data-layer="footprint"]')).toHaveCount(2);
 await page.locator('#twin-run-speed').selectOption('64');
 await page.getByRole('button',{name:'Auto-run'}).click();
 await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:600000});

 const runId=(await page.getByTestId('run-id').textContent())!.trim();
 const r=await page.evaluate(async id=>(await fetch(`/lab/v2/runs/${id}/report`,{credentials:'same-origin'})).json(),runId) as Report;
 // the run: IR-FD07 on the IR-SIM plant, both orders served after their handoffs, within the 12,000-tick bound; the preset says what is not drawn
 await expect(page.locator('#preset-irsim-fd07-summary')).toContainText('server-side only and not drawn here');
 expect(r.metrics.maxConcurrentMovers).toBe(1);
 expect(r.manifest.scenario.id).toBe('IR-FD07');expect(r.manifest.backends.map(b=>b.id)).toEqual(['irsim_2d']);expect(r.navigation2d?.engine.id).toBe('irsim_2d');
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});expect(r.outcome.tick).toBeLessThanOrEqual(12000);
 expect(r.entities.map(e=>e.id).sort()).toEqual(['robot01','robot02']);
 // two distinct physical models (per robot, by robotId)
 const models=r.manifest.models.filter(m=>m.id.startsWith('navigation-model:'));
 expect(models.map(m=>m.id).sort()).toEqual(['navigation-model:robot01','navigation-model:robot02']);expect(new Set(models.map(m=>m.hash)).size).toBe(2);
 // the aisle zone was reserved by both robots through the source's Zone.Reserve/Release, and released by each
 const zone=r.businessEvents.filter(e=>e.kind==='reservation'&&e.state.zoneId==='aisle-west');
 for(const id of ['robot01','robot02']){
  expect(zone.some(e=>e.type==='ZoneReservationGranted'&&e.state.robotId===id),`${id} granted`).toBe(true);
  expect(zone.some(e=>e.type==='ZoneReservationReleased'&&e.state.robotId===id),`${id} released`).toBe(true);
 }
 // metrics from the durable trace: complete coverage, both robots travelled, a robot-robot separation exists (two robots), no contact episode
 const nav=r.metrics.navigation!;
 expect(r.navigation2d!.completeness!.status).toBe('complete');expect(nav.coverage).toBe('complete');expect(nav.horizon).toBe(r.outcome.tick);
 expect(nav.distanceM!.robot01).toBeGreaterThan(5);expect(nav.distanceM!.robot02).toBeGreaterThan(5);
 expect(r.metrics.distanceM).toEqual(nav.distanceM);
 expect(nav.minSeparationM).toBeGreaterThan(0);expect(r.metrics.collision).toMatchObject({available:true,contacts:0});expect(nav.collisionEpisodes).toBe(0);
 expect(nav.sensorPublications.complete).toBe(true);
 // the report panel shows the evidence verdict of the whole run
 const panel=page.getByTestId('navigation-evidence');
 await expect(panel).toHaveAttribute('data-supported','true');await expect(panel).toHaveAttribute('data-complete','true',{timeout:30000});
 await context.close();
});
