// U06: the mesh fallback at launcher level. With the xArm 6 STL requests blocked, MJ-BV01 still runs to completed on the real MuJoCo worker; the 3D view draws the arm
// as its joint chain (cylinders) and lists ARM_MESH_UNAVAILABLE as a note, which is not counted as a problem. Its own launcher run (scripts/test-irsim-e2e.mjs --provider mujoco
// tests/e2e/mujoco-mesh-fallback.spec.ts): the pairing code is one-use and a same-origin session lives in the page, while the parsed meshes are cached per page, so the
// blocked load needs a page of its own that has never loaded them.
import {test,expect} from '@playwright/test';
import {barLayout,openInspector,openProblems,openScenarioPicker,WIDTHS} from '../support/twin';
const token=process.env.LAB_TEST_PAIRING_TOKEN,dir=process.env.LAB_EVIDENCE_DIR??process.env.LAB_IRSIM_SCREENSHOTS;

test('MJ-BV01 with the arm meshes unavailable: joint chain, one ARM_MESH_UNAVAILABLE note (not a problem), and the run completes',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider mujoco tests/e2e/mujoco-mesh-fallback.spec.ts: it starts lab:mujoco and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(600000);
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
 let blocked=0;await page.route('**/fixtures/xarm6-g2-v1/blobs/*.stl',r=>{blocked++;return r.abort();});
 await page.goto('/#twin');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Ghép nối runtime'}).click();
 await expect(page.getByTestId('runtime-popover')).toBeHidden();
 await openScenarioPicker(page);await page.getByRole('button',{name:'MuJoCo · cà phê với tay máy xArm 6'}).click();
 const primary=page.getByTestId('primary-action');await expect(primary).toHaveText('Chạy MuJoCo (tay máy)',{timeout:180000});await primary.click();
 const canvas=page.locator('#twin-stage canvas'),ds=(k:string)=>canvas.evaluate((c,key)=>(c as HTMLCanvasElement).dataset[key]??'',k);
 await expect.poll(()=>ds('armFallback'),{timeout:60000}).toContain('ARM_MESH_UNAVAILABLE');
 expect(blocked).toBeGreaterThan(0);expect(await ds('armModel')).toBe('chain');expect(await ds('armMeshLinks')).toBe('0');
 // the cell's supports and the mount are drawn with the xArm's joint-chain fallback too
 expect(await ds('armSupports')).toBe('2');
 await page.locator('#twin-run-speed').selectOption('64');await page.locator('#twin-transport [data-action="twin-play"]').click();
 await expect(page.getByTestId('run-status')).toContainText('Hoàn thành',{timeout:420000});
 // listed as a note, not counted as a problem
 await expect(page.getByTestId('problems-count')).toHaveCount(0);await expect(page.getByTestId('notes-count')).toHaveText('1 lưu ý');
 await page.getByTestId('notes-count').click();await expect(page.getByTestId('problems-panel')).toBeVisible();await openProblems(page);
 const row=page.getByTestId('problem-row');await expect(row).toHaveCount(1);await expect(row).toHaveAttribute('data-severity','notice');await expect(row).toContainText('ARM_MESH_UNAVAILABLE');
 await expect(page.getByTestId('problems-panel').locator('h3')).toHaveText('Lưu ý');
 await expect(page.getByTestId('run-served').locator('b')).toHaveText('2');expect(await ds('armModel')).toBe('chain');
 // the report agrees: the run completed with both cups served (the panel is closed first: it lies over the inspector's tabs)
 await page.getByTestId('notes-count').click();await expect(page.getByTestId('problems-panel')).toBeHidden();
 await openInspector(page,'engineering');const id=(await page.getByTestId('run-id').textContent())!.trim();
 const r=await page.evaluate(async x=>(await fetch(`/lab/v2/runs/${x}/report`,{credentials:'same-origin'})).json(),id) as {outcome:{status:string;served:string}};
 expect(r.outcome).toMatchObject({status:'completed',served:'2'});
 await page.locator('[data-action="twin-inspector-toggle"]').click();
 if(dir)await page.screenshot({path:`${dir}/U06-mesh-fallback-notes.png`});
 // I3: the flagship end state (simulation label, completed, "run again", one note) at three widths: the scenario readable on one line, the label whole,
 // nothing overlapping, no horizontal scroll (the bar wraps instead)
 await expect(page.getByTestId('mode-badge')).toHaveText('Mô phỏng · chưa hiệu chuẩn');await expect(page.getByTestId('primary-action')).toHaveText('Chạy lại cùng đầu vào');
 for(const [w,h] of WIDTHS){await page.setViewportSize({width:w,height:h});await page.waitForTimeout(200);
  expect(await barLayout(page),`completed + note ${w}`).toEqual({oneLine:true,twelve:true,label:true,overlaps:[],inside:true,noScroll:true,title:true});
  if(dir)await page.screenshot({path:`${dir}/final-I3-mujoco-completed-note-${w}x${h}.png`});}
 await context.close();
});
