// Design -> save -> export/import in the browser with no runtime running (preview mode). Compile needs a runtime that advertises engineering_bundle_v1 and is covered by
// the source gateway/compiler tests; nothing here claims a compile or a native run.
import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';

const open=async(page:Page)=>{await page.goto('/#assembly');await page.getByRole('button',{name:'EN',exact:true}).click();await expect(page.getByTestId('assembly-page')).toBeVisible();};
const digest=(page:Page)=>page.getByTestId('asm-digest').innerText();
const rows=(page:Page)=>page.getByTestId('asm-instances').locator('tr');

test('a fresh draft shows its blockers, and without a runtime says it cannot compile',async({page})=>{
  await open(page);
  await expect(page.getByTestId('asm-problems')).toContainText('UNBOUND_ENTITY');
  // item 6: no runtime answered, so nothing is known of its capabilities: "not connected", and Compile stays pressable (it asks again)
  await expect(page.getByTestId('asm-no-runtime')).toHaveAttribute('data-reason','not-connected');await expect(page.getByTestId('asm-no-runtime')).not.toContainText('engineering_bundle_v1');
  await expect(page.getByRole('button',{name:'Compile on runtime'})).toBeEnabled();
  await expect(page.getByTestId('asm-receipt')).toHaveCount(0);        // no receipt, so nothing looks compiled
});
test('the reference AMR opens clean; editing changes the design id and undo/redo restore it',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await expect(rows(page)).toHaveCount(7);
  await expect(page.getByTestId('asm-problems')).toContainText('No structural problems in the preview. That does not mean valid');
  const before=await digest(page);
  await page.getByTestId('asm-instances').getByRole('button',{name:'Remove'}).last().click();
  await expect(rows(page)).toHaveCount(6);
  expect(await digest(page)).not.toBe(before);
  await page.getByTestId('assembly-page').getByRole('button',{name:'Undo'}).click();
  await expect(rows(page)).toHaveCount(7);
  await page.getByTestId('assembly-page').getByRole('button',{name:'Redo'}).click();
  await expect(rows(page)).toHaveCount(6);
  await page.getByTestId('assembly-page').getByRole('button',{name:'Undo'}).click();
  expect(await digest(page)).not.toBe(before);          // undo is a new revision of the same content: the id covers content AND revision
});
test('changing a part changes what the design is, and a wrong mate is a blocker',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  const before=await digest(page);
  await page.locator('.asm-parts tr',{hasText:'caster-ref'}).getByRole('button',{name:'Add'}).click();
  await expect(rows(page)).toHaveCount(8);
  expect(await digest(page)).not.toBe(before);
  await page.locator('#asm-connect select[name=from]').selectOption('chassis/tray-plate');
  await page.locator('#asm-connect select[name=to]').selectOption('caster/mount');
  await page.locator('#asm-connect').getByRole('button',{name:'Connect'}).click();
  await expect(page.getByTestId('asm-problems')).toContainText('MOUNT_MISMATCH');
  await expect(page.getByTestId('asm-problems')).toContainText('PORT_REUSED');
  await page.getByTestId('asm-connections').getByRole('button',{name:'Disconnect'}).last().click();
  await expect(page.getByTestId('asm-problems')).not.toContainText('MOUNT_MISMATCH');
});
test('the draft is saved and comes back after a reload',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await expect(page.getByTestId('asm-save-state')).toHaveAttribute('data-state','saved');
  const saved=await digest(page);
  await page.reload();
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await expect(rows(page)).toHaveCount(7);
  expect(await digest(page)).toBe(saved);
});
test('export then import in a clean browser context restores the same design; a damaged file is refused and changes nothing',async({page,browser})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  const original=await digest(page);
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export engineering project'}).click()]);
  const file=await download.path();
  const text=readFileSync(file!,'utf8');
  expect(JSON.parse(text).manifest.documentType).toBe('engineering-project-archive');
  expect(text).not.toMatch(/csrf|token|session|proof/i);                // an export carries no session material

  const other=await (await browser.newContext()).newPage();
  await open(other);
  await other.locator('#asm-import').setInputFiles(file!);
  await expect(rows(other)).toHaveCount(7);
  expect(await digest(other)).toBe(original);

  await other.locator('#asm-import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(text.replace(/"id":"chassis"/,'"id":"chassis","controllerEndpoint":"http://x"'))});
  await expect(other.getByTestId('asm-message')).toContainText('Could not import');
  await expect(rows(other)).toHaveCount(7);
  expect(await digest(other)).toBe(original);
  await other.close();
});
test('switching language never loses the design',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  const id=await digest(page);
  for (const code of ['JA','VI','EN']) {await page.getByRole('button',{name:code,exact:true}).click();await expect(rows(page)).toHaveCount(7);expect(await digest(page)).toBe(id);}
  await page.getByRole('button',{name:'JA',exact:true}).click();
  await expect(page.getByTestId('asm-no-runtime')).toContainText('デジタルツイン');
});
test('a candidate draft downloads with null digests and the blocker when nothing was compiled',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download candidate draft'}).click()]);
  const c=JSON.parse(readFileSync((await download.path())!,'utf8'));
  expect(c).toMatchObject({documentType:'engineering-candidate',status:'draft',hardwareValidated:false,controlAuthority:false,bundleDigest:null,assemblyDigest:null});
  expect(c.problems.map((p:{code:string})=>p.code)).toContain('BUNDLE_NOT_COMPILED');
});
test('after several edits a reload restores the very same design id, and saves nothing new',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await page.getByTestId('asm-instances').getByRole('button',{name:'Remove'}).last().click();
  await page.getByTestId('assembly-page').getByRole('button',{name:'Undo'}).click();
  await expect(page.getByTestId('asm-save-state')).toHaveAttribute('data-state','saved');
  const saved=await digest(page);
  await page.reload();
  await page.getByRole('button',{name:'EN',exact:true}).click();
  await expect(rows(page)).toHaveCount(7);
  expect(await digest(page)).toBe(saved);
  await page.reload();
  await page.getByRole('button',{name:'EN',exact:true}).click();
  expect(await digest(page)).toBe(saved);          // a second reload does not drift either
});
test('an imported archive keeps its blobs, licenses, assets and recipes through export, and survives opening the reference and undoing',async({page})=>{
  const wire=readFileSync(new URL('../../fixtures/engineering/rich-archive.json',import.meta.url),'utf8'),archive=JSON.parse(wire) as {manifest:{blobs:{mediaType:string;license:string}[]}};
  await open(page);
  await page.locator('#asm-import').setInputFiles({name:'rich.json',mimeType:'application/json',buffer:Buffer.from(wire)});
  await expect(rows(page)).toHaveCount(5);
  const exportOnce=async()=>{const [d]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Export engineering project'}).click()]);return JSON.parse(readFileSync((await d.path())!,'utf8'));};
  const first=await exportOnce();
  expect(Object.keys(first.files).sort()).toEqual(Object.keys(JSON.parse(wire).files).sort());
  expect(first.manifest.blobs.map((b:{mediaType:string;license:string})=>`${b.mediaType}/${b.license}`).sort()).toEqual(archive.manifest.blobs.map(b=>`${b.mediaType}/${b.license}`).sort());
  expect(first.manifest.assets).toHaveLength(1);expect(first.manifest.recipes).toHaveLength(1);
  expect(first.manifest.missingDigests).toEqual([]);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await page.getByTestId('assembly-page').getByRole('button',{name:'Undo'}).click();
  await expect(rows(page)).toHaveCount(5);
  await expect(page.getByTestId('asm-problems')).not.toContainText('COMPONENT_UNAVAILABLE');
  const again=await exportOnce();
  expect(Object.keys(again.files).sort()).toEqual(Object.keys(first.files).sort());
  expect(again.manifest.components).toHaveLength(first.manifest.components.length);
});
test('the page shows the AMR mass the design implies and says what is missing for energy, instead of inventing it',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Open FD01 reference AMR'}).click();
  await expect(page.getByTestId('asm-est-mass')).toContainText('kg');
  await expect(page.getByTestId('asm-est-energy')).toContainText('unknown');
  await expect(page.getByTestId('asm-est-missing')).toContainText('ENERGY_CAPACITY_UNAVAILABLE');
});
