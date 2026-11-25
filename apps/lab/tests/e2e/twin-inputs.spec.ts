import {test,expect,type Page} from '@playwright/test';
import type {CreateRun,RunReport,RunView} from '../../src/scenarios/controls';
import {openDisplayMenu,openInspector,openScenarioPicker} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
type InputReport=RunReport&{manifest:{configuration:{revision:number;hash:string}}};

async function createRun(page:Page,button:string,previousId?:string){
 const responsePromise=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname==='/lab/v2/runs');
 await page.getByRole('button',{name:button,exact:true}).click();
 const response=await responsePromise;
 expect(response.ok(),`Create run HTTP ${response.status()}`).toBe(true);
 const view=await response.json() as RunView;
 expect(view.run.id).toMatch(/^[0-9a-f-]{36}$/);
 if(previousId)expect(view.run.id).not.toBe(previousId);
 // The click starts asynchronous save/archive/create work; the previous ID remains visible until it finishes.
 await expect(page.getByTestId('run-id')).toHaveText(view.run.id);
 return {id:view.run.id,input:response.request().postDataJSON() as CreateRun};
}

async function report(page:Page,id:string):Promise<InputReport>{
 const response=await page.request.get(`/lab/v2/runs/${id}/report`);
 expect(response.status(),`Report for the newly created run ${id}`).toBe(200);
 const value=await response.json() as InputReport;
 expect(value.manifest.runId).toBe(id);
 expect(value.manifest.configuration.hash).toMatch(/^[0-9a-f]{64}$/);
 return value;
}

test('UX05/UX18/QA09b: reset, speed-limit draft, saved report reopening and replay remain independent',async({page})=>{
 test.skip(!token,'Requires the real exported runtime launcher.');test.setTimeout(150000);
 await page.goto('/#twin');await page.getByRole('button',{name:'EN',exact:true}).click();await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime',exact:true}).click();
 await openScenarioPicker(page);await page.getByRole('button',{name:'One delivery order',exact:true}).click();await openDisplayMenu(page);await page.getByRole('button',{name:'2D',exact:true}).click();
 const original=await createRun(page,'Run mock');
 await page.locator('#twin-run-speed').selectOption('64');await page.getByRole('button',{name:'Auto-run',exact:true}).click();await expect(page.getByTestId('run-status')).toContainText('Completed',{timeout:90000});
 const originalReport=await report(page,original.id);
 await openInspector(page,'report');await page.getByRole('button',{name:'Save immutable report',exact:true}).click();await expect(page.getByTestId('saved-evidence')).toContainText('inputs match');
 await openInspector(page,'setup');await page.locator('#twin-speed-limit').fill('0.2');await page.locator('#twin-speed-limit').blur();await expect(page.getByTestId('saved-evidence')).toContainText('stale evidence: profile');
 const reset=await createRun(page,'Reset (new run)',original.id);
 await expect(page.getByTestId('run-tick')).toContainText('0.0 s');await expect(page.getByTestId('run-status')).toContainText('Ready');
 expect(reset.input.project).toEqual(original.input.project);
 const resetReport=await report(page,reset.id);
 expect(resetReport.manifest.configuration).toEqual(originalReport.manifest.configuration);
 expect(resetReport.manifest.project).toEqual(originalReport.manifest.project);
 expect(resetReport.manifest.designHash).toBe(originalReport.manifest.designHash);

 // Reset keeps the original immutable inputs; only an explicit new-input run uses the draft limit.
 const edited=await createRun(page,'Run with edited inputs',reset.id);
 const limits=edited.input.project!.entities.filter(entity=>entity.kind==='amr').map(entity=>entity.speedLimitMps);
 expect(limits.length).toBeGreaterThan(0);expect(limits.every(limit=>limit===0.2)).toBe(true);
 const editedReport=await report(page,edited.id);
 expect(editedReport.manifest.configuration.hash).not.toBe(originalReport.manifest.configuration.hash);
 expect(editedReport.manifest.project.hash).not.toBe(originalReport.manifest.project.hash);
 expect(editedReport.manifest.designHash).toMatch(/^[0-9a-f]{64}$/);
 expect(editedReport.manifest.designHash).not.toBe(originalReport.manifest.designHash);
 expect(editedReport.manifest.world).toEqual(originalReport.manifest.world);
 await openInspector(page,'report');await page.getByTestId('saved-evidence').getByRole('button').filter({hasText:original.id.slice(0,8)}).first().click();await expect(page.getByTestId('replay-panel')).toBeVisible();await expect(page.getByTestId('run-id')).toHaveText(original.id);await page.locator('#twin-replay-cursor').fill('0');await expect(page.getByTestId('run-served')).toContainText('0');
});
