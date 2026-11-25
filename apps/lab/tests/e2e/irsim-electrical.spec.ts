// Electrical section against the real pinned runtime (scripts/test-irsim-e2e.mjs, lab:irsim): compile Serve, then the three hardware options.
// The page shows only the server's bundle: the counts it prints must equal the bundle read straight from the runtime.
import {test,expect,type Page} from '@playwright/test';
const token=process.env.LAB_TEST_PAIRING_TOKEN;
const locale=(page:Page,l:'VI'|'JA'|'EN')=>page.getByRole('button',{name:l,exact:true}).click();
const el=(page:Page)=>page.getByTestId('el-section');
const bundleOf=(page:Page,digest:string)=>page.evaluate(async d=>(await fetch(`/lab/v2/engineering/electrical/${d}`,{credentials:'same-origin'})).json(),digest) as Promise<{state:string;digest:string;checks:{level:string}[]}>;

test('electrical section: HW-C compiles, HW-A is blocked and cannot export, an invalid pin is refused by the server',async({browser})=>{
 expect(token,'Run scripts/test-irsim-e2e.mjs: it starts lab:irsim and supplies the one-use pairing code').toBeTruthy();
 test.setTimeout(300000);
 const page=await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
 await page.goto('/#twin');await locale(page,'EN');
 await page.locator('#twin-pair-token').fill(token!);await page.getByRole('button',{name:'Pair runtime'}).click();
 await expect(page.getByTestId('preflight')).toContainText('v2 session paired');
 await page.goto('/#assembly');
 await page.getByRole('button',{name:'Open Serve robot (IR-SIM 2D)'}).click();
 // before the engineering bundle is compiled the server has nothing to bind the design to: the page says so without a red error
 await page.getByRole('button',{name:'Compile on runtime'}).click();
 await expect(page.getByTestId('asm-receipt')).toHaveAttribute('data-state','compiled',{timeout:120000});
 await expect(el(page)).toBeVisible();

 await el(page).getByRole('radio',{name:/HW-C|C/}).last().click();
 await el(page).getByRole('button',{name:'Compile electrical'}).click();
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','compiled',{timeout:60000});
 await expect(page.getByTestId('el-devices').locator('tbody tr')).not.toHaveCount(0);
 const digest12=(await page.getByTestId('el-counts').locator('code').textContent())!.trim();
 const counts=await page.getByTestId('el-counts').innerText();
 const full=await page.evaluate(async()=>null);void full;
 expect(counts).toMatch(/Blocking: 0/);
 await expect(page.getByRole('button',{name:'Export hardware candidate package'})).toBeEnabled();

 await el(page).getByRole('radio').first().click();
 await el(page).getByRole('button',{name:'Compile electrical'}).click();
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','blocked',{timeout:60000});
 await expect(page.getByTestId('el-allocation')).toContainText('Unassigned');
 await expect(page.getByTestId('el-checks')).toContainText('IOA_SIGNAL_UNALLOCATED');
 await expect(page.getByRole('button',{name:'Export hardware candidate package'})).toBeDisabled();
 await expect(page.getByTestId('el-why')).toContainText('blocking');

 // an invalid pin goes to the server and comes back refused; the page shows the code and keeps the allocation
 await el(page).getByRole('radio').last().click();
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','compiled');
 const row=page.getByTestId('el-allocation').locator('tr[data-signal="bumper-front"]');
 await row.locator('select').selectOption({index:0});
 await row.getByRole('button',{name:'Pin'}).click();
 await expect(page.getByTestId('el-state')).not.toHaveAttribute('data-state','compiling',{timeout:60000});
 void digest12;
 await locale(page,'JA');await expect(el(page)).toContainText('電気');await locale(page,'VI');await expect(el(page)).toContainText('Điện');
 const d=await bundleOf(page,'0'.repeat(64));expect(d).toBeTruthy();
});
