import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {openInspector,openScenarioPicker} from '../support/twin';
import runtimeLock from '../../config/source-runtime.lock.json' with {type:'json'};
// Requires the built offline package via LAB_TEST_OFFLINE_ROOT. Browser network
// isolation is recorded separately from the clean-machine/OS network-off gate.
test('offline package completes BV01 and exports its pinned report with only loopback requests',async({page})=>{
 test.skip(!process.env.LAB_TEST_OFFLINE_ROOT||!process.env.LAB_TEST_PAIRING_TOKEN,'Run the offline package through scripts/test-mock-e2e.mjs.');
 test.setTimeout(180000);
 const external:string[]=[];
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(['http:','https:'].includes(u.protocol)&&!['127.0.0.1','localhost'].includes(u.hostname)){external.push(u.href);await route.abort();}else await route.continue();
 });
 await page.goto('/#twin');
 await page.locator('#twin-pair-token').fill(process.env.LAB_TEST_PAIRING_TOKEN!);
 await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await openScenarioPicker(page);
 await page.getByRole('button',{name:'Cà phê sữa đá'}).click();
 await page.getByRole('button',{name:'Chạy mock',exact:true}).click();
 await page.locator('#twin-run-speed').selectOption('64');
 await page.getByRole('button',{name:'Tự chạy',exact:true}).click();
 await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:150000});
 await expect(page.getByTestId('run-served')).toContainText('2');
 await expect(page.getByTestId('cup-owner')).toHaveText('T01');
 const downloaded=page.waitForEvent('download');
 await openInspector(page,'report');
 await page.locator('[data-action="twin-export"][data-value="json"]').click();
 const download=await downloaded,report=JSON.parse(await readFile((await download.path())!,'utf8'));
 expect(report.manifest).toMatchObject({sourceCommit:runtimeLock.sourceCommit,mode:'mock',scenario:{id:'BV01'}});
 expect(report.outcome).toMatchObject({status:'completed',served:'2'});
 expect(report.coffee.cups).toHaveLength(2);
 expect(report.coffee.cups.every((c:{ownerKind:string})=>c.ownerKind==='customer')).toBe(true);
 expect(external).toEqual([]);
 if(process.env.LAB_EVIDENCE_DIR)await page.screenshot({path:`${process.env.LAB_EVIDENCE_DIR}/R02-offline-bv01.png`,fullPage:true});
});
