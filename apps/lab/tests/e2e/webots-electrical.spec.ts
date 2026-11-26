// Electrical section against the real pinned runtime (scripts/test-irsim-e2e.mjs --provider webots). The designs are for the Serve 3D project; compiling it needs the Webots
// compiler, not a Webots run. The page shows only the server's bundle: the counts it prints must equal the bundle read straight from the runtime.
import {test,expect,type Page} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const SOURCE_ROOT=fileURLToPath(new URL('../../../../',import.meta.url));
const token=process.env.LAB_TEST_PAIRING_TOKEN;
const locale=(page:Page,l:'VI'|'JA'|'EN')=>page.getByRole('button',{name:l,exact:true}).click();
const el=(page:Page)=>page.getByTestId('el-section');
const isCompile=(r:{request():{method():string};url():string})=>r.request().method()==='POST'&&/\/engineering\/electrical$/.test(r.url());
const read=(page:Page,digest:string)=>page.evaluate(async d=>(await fetch(`/lab/v2/engineering/electrical/${d}`,{credentials:'same-origin'})).json(),digest) as Promise<{state:string;checks:{level:string}[]}>;
async function compile(page:Page,option:RegExp){
 await el(page).getByRole('radio',{name:option}).click();
 const answered=page.waitForResponse(isCompile);await el(page).getByRole('button',{name:'Compile electrical'}).click();
 const response=await answered;expect(response.status()).toBe(200);
 return (await response.json()) as {digest:string;state:string};
}

// DGN01: choose an option → compile → check → wiring → export (or its stated refusal) → cost → pin; HW-A cannot export
test('electrical section: HW-C compiles and the page equals the server bundle, HW-A is blocked and cannot export, a pin goes to the server and the page follows its answer',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs --provider webots: it starts the launcher and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(300000);
 const page=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage(),errors:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#twin');await locale(page,'EN');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open Serve robot (Webots 3D)'}).click();
 // the electrical design binds to a compiled engineering bundle of this exact draft, so that is compiled first
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 await expect(el(page)).toBeVisible();

 const c=await compile(page,/^HW-C/);
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','compiled');
 const direct=await read(page,c.digest),count=(l:string)=>direct.checks.filter(x=>x.level===l).length;
 await expect(page.getByTestId('el-counts')).toContainText(`Blocking: ${count('blocking')}`);
 await expect(page.getByTestId('el-counts')).toContainText(`Warning: ${count('warning')}`);
 await expect(page.getByTestId('el-counts')).toContainText(`Unverified: ${count('unverified')}`);
 expect(count('blocking')).toBe(0);
 await expect(page.getByTestId('el-devices').locator('tbody tr')).not.toHaveCount(0);
 // checks: a level filter shows only that level, with the server's count
 await el(page).locator('[data-action="el-filter"][data-value="unverified"]').click();
 await expect(el(page).locator('[data-action="el-filter"][data-value="unverified"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.getByTestId('el-checks').locator('li')).toHaveCount(Math.min(200,count('unverified')));
 if(count('unverified'))await expect(page.getByTestId('el-checks').locator('li[data-level]:not([data-level="unverified"])')).toHaveCount(0);
 await el(page).locator('[data-action="el-filter"][data-value="all"]').click();
 // wiring: the diagram and the wire table; choosing a wire names its two ends
 await expect(page.getByTestId('el-wiring').locator('svg')).toBeVisible();
 const wire=page.getByTestId('el-wires').locator('tbody tr').first(),wireId=await wire.getAttribute('data-wire');
 await wire.locator('[data-action="el-wire"]').click();
 await expect(page.getByTestId('el-wires').locator(`tr[data-wire="${wireId}"]`)).toHaveAttribute('aria-selected','true');
 await expect(page.getByTestId('el-wiring').getByRole('status')).toContainText('→');
 // export. A runtime whose engineering service has no base drive model (today the Webots launcher: only the MuJoCo mobile one passes drive-v1) drafts no drive model,
 // and the package needs one: the page disables the export and says why. With a drafted drive model the package downloads as a ZIP folder whose files re-hash
 // to its manifest and that the runtime's own reader (lab-hardware.mjs verify) passes.
 const draft=(await read(page,c.digest) as unknown as {driveModelDraft:unknown}).driveModelDraft,exportButton=page.getByRole('button',{name:'Export hardware candidate package'});
 if(draft===null){await expect(exportButton).toBeDisabled();await expect(page.getByTestId('el-why')).toContainText('DRIVE_MODEL_DRAFT_MISSING');}
 else{
  const downloaded=page.waitForEvent('download');await exportButton.click();
  const file=await downloaded;expect(file.suggestedFilename()).toBe('serve-hw-c-v1.hardware-candidate.zip');
  const dir=await mkdtemp(join(tmpdir(),'mekoniq-hwc-'));execFileSync('unzip',['-q',(await file.path())!,'-d',dir]);
  const manifest=JSON.parse(await readFile(join(dir,'manifest.json'),'utf8')) as {documentType:string;hardwareValidated:boolean;bundle:{digest:string};files:{path:string;sha256:string;bytes:number}[]};
  expect(manifest).toMatchObject({documentType:'hardware-candidate',hardwareValidated:false,bundle:{digest:c.digest}});
  for(const f of manifest.files){const b=await readFile(join(dir,f.path));expect([f.path,b.length,createHash('sha256').update(b).digest('hex')]).toEqual([f.path,f.bytes,f.sha256]);}
  expect(execFileSync(process.execPath,['scripts/lab-hardware.mjs','verify','--package',dir],{cwd:SOURCE_ROOT,encoding:'utf8'})).toContain('package reads back without a problem');
 }

 const a=await compile(page,/^HW-A/);
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','blocked');
 expect((await read(page,a.digest)).state).toBe('blocked');
 await expect(page.getByTestId('el-allocation')).toContainText('Unassigned');
 await expect(page.getByTestId('el-checks')).toContainText('IOA_SIGNAL_UNALLOCATED');
 await expect(page.getByRole('button',{name:'Export hardware candidate package'})).toBeDisabled();
 await expect(page.getByTestId('el-why')).toContainText('blocking');
 // cost: two options are compiled, so the server compares them; a total missing a price is "not comparable", never a 0
 const compared=page.waitForResponse(r=>r.request().method()==='POST'&&/\/engineering\/electrical\/compare$/.test(r.url()));
 await page.getByTestId('el-cost').getByRole('button',{name:'Compare the three options'}).click();
 const tco=await (await compared).json() as {options:{designId:string;comparable:boolean;total:number|null}[]};
 await expect(page.getByTestId('el-cost').locator('tbody tr')).toHaveCount(tco.options.length);
 for(const o of tco.options)await expect(page.getByTestId('el-cost').locator('tbody tr',{hasText:o.designId})).toContainText(o.comparable?String(o.total):'not comparable');

 // a pin travels to the server; whatever it answers (a new bundle or a refusal code) is what the page shows
 await el(page).getByRole('radio',{name:/^HW-C/}).click();
 const row=page.getByTestId('el-allocation').locator('tr[data-signal="bumper-front"]');
 await row.locator('select').selectOption({index:0});
 const pinned=page.waitForResponse(isCompile);await row.getByRole('button',{name:'Pin'}).click();
 const answer=await pinned;
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state',answer.status()===200?/compiled|blocked/:'rejected');
 await locale(page,'JA');await expect(el(page)).toContainText('電気');await locale(page,'VI');await expect(el(page)).toContainText('Điện');
 expect(errors).toEqual([]);
});
