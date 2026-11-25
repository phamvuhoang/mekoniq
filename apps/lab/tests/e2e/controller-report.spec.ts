import {test,expect} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const fixture=JSON.parse(readFileSync(new URL('../../fixtures/twins/coffee-cell-v2.json',import.meta.url),'utf8'));
import {controllerReportFixture} from '../support/controller-report';
import {openInspector} from '../support/twin';
import {hashJson} from '../../src/twin/hash';
// Fixture rendering/import evidence only. This test does not execute LinuxCNC or Gazebo.
test('imported controller fixture is read-only and reveals collision only at the recorded cursor',async({page})=>{
 const directory=await mkdtemp(join(tmpdir(),'controller-evidence-'));const report=controllerReportFixture(20),project=fixture.project,bytes='protocol_double controller trace';
 report.manifest.project={id:project.id,revision:project.revision,hash:hashJson(project)};report.manifest.world={id:project.world.id,revision:project.world.revision,hash:hashJson(project.world)};report.verification!.arm!.worldRevision={...report.manifest.world};
 const sha=createHash('sha256').update(bytes).digest('hex');report.verification!.artifacts=[{path:'trace.txt',bytes:Buffer.byteLength(bytes),sha256:sha}];report.verification!.aspects=[{name:'controller fixture',producer:'protocol_double',fidelity:'controller_sim',artifactSha256:sha}];
 let actions=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/actions'))actions++;});
 try{
  await Promise.all([writeFile(join(directory,'report.json'),JSON.stringify(report)),writeFile(join(directory,'project.json'),JSON.stringify(project)),writeFile(join(directory,'trace.txt'),bytes)]);
  await page.goto('/#twin');await openInspector(page,'report');await page.locator('#twin-import-evidence').setInputFiles(directory);
  await expect(page.getByTestId('saved-evidence')).toContainText('Đã nhập');await page.getByTestId('saved-evidence').getByRole('button',{name:/Đã nhập/}).click();
  await expect(page.getByTestId('controller-verification')).toContainText('protocol_double');
  const cursor=page.locator('#twin-replay-cursor');await cursor.fill('10');await cursor.dispatchEvent('input');
  await expect(page.getByTestId('controller-verification')).toContainText('ARM03: not_run');
  await cursor.fill('20');await cursor.dispatchEvent('input');await expect(page.getByTestId('controller-verification')).toContainText('ARM03: fail');
  expect(actions).toBe(0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
