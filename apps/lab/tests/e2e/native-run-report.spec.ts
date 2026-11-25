import {readFile} from 'node:fs/promises';
import type {RunReport} from '../../src/scenarios/controls';
import {expect,test} from '@playwright/test';
import {openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_NATIVE_PAIRING_TOKEN;
// External native environment only: neither test starts a mock provider or upgrades fixture evidence.
test('native UI pairing, start, SSE, report download and read-only replay',async({page})=>{
 test.skip(!token||!process.env.LAB_NATIVE_BASE_URL,'not_run: NATIVE_PROVIDER_ENVIRONMENT_UNAVAILABLE');
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();await openScenarioPicker(page);await page.locator('[data-action="twin-preset"][data-value="native-bv01"]').click();
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime',exact:true}).click();
 const start=page.getByRole('button',{name:'Run native simulation',exact:true});await expect(start).toBeEnabled({timeout:15000});await start.click();
 await openInspector(page,'engineering');await expect(page.getByTestId('twin-telemetry')).toContainText('SSE',{timeout:20000});
 await expect(page.getByTestId('run-status')).toHaveText('Completed',{timeout:210000});await expect(page.getByTestId('run-served')).toHaveText('2');
 await openInspector(page,'report');const downloaded=page.waitForEvent('download');await page.locator('[data-action="twin-export"][data-value="json"]').click();const report=JSON.parse(await readFile(await (await downloaded).path(),'utf8')) as RunReport;
 expect(report.manifest.mode).toBe('simulation');expect(report.manifest.runId).toBe(await page.getByTestId('run-id').textContent());expect(report.verification).toMatchObject({execution:'ran',result:'pass',blockers:[]});expect(report.verification?.arm?.result).toBe('pass');expect(report.coffee?.armTrace.samples).toEqual([]);
 for(const provider of ['gazebo_nav2','linuxcnc_sim'])expect(report.telemetry?.samples.some(s=>s.providerId===provider)).toBe(true);
 await page.locator('[data-action="twin-replay"]').click();const before=writes.length;await page.locator('#twin-replay-cursor').fill(String(Math.floor(report.outcome.tick/2)));await expect(page.getByTestId('replay-panel')).toContainText('Read-only');expect(writes.length).toBe(before);
});
test('import actual native bundle through UI verifies hashes and replays without commands',async({page})=>{
 const bundle=process.env.LAB_NATIVE_IMPORT_BUNDLE;test.skip(!bundle||!process.env.LAB_NATIVE_BASE_URL,'not_run: NATIVE_IMPORT_BUNDLE_UNAVAILABLE');
 const report=JSON.parse(await readFile(`${bundle}/report.json`,'utf8')) as RunReport;expect(report.verification).toMatchObject({execution:'ran',result:'pass'});
 const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();await openInspector(page,'report');await page.locator('#twin-import-evidence').setInputFiles(bundle!);
 await expect(page.getByRole('status').filter({hasText:'Read-only evidence imported'})).toBeVisible();await page.locator('[data-action="twin-open-evidence"]').filter({hasText:report.manifest.runId.slice(0,8)}).click();await expect(page.getByTestId('replay-panel')).toContainText('Read-only');await page.locator('#twin-replay-cursor').fill(String(Math.floor(report.outcome.tick/2)));expect(writes).toEqual([]);
});
