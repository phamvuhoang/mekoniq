// Electrical section against the real pinned runtime (scripts/test-irsim-e2e.mjs --provider webots). The designs are for the Serve 3D project; compiling it needs the Webots
// compiler, not a Webots run. The page shows only the server's bundle: the counts it prints must equal the bundle read straight from the runtime.
import {test,expect,type Page} from '@playwright/test';
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
 await expect(page.getByRole('button',{name:'Export hardware candidate package'})).toBeEnabled();

 const a=await compile(page,/^HW-A/);
 await expect(page.getByTestId('el-state')).toHaveAttribute('data-state','blocked');
 expect((await read(page,a.digest)).state).toBe('blocked');
 await expect(page.getByTestId('el-allocation')).toContainText('Unassigned');
 await expect(page.getByTestId('el-checks')).toContainText('IOA_SIGNAL_UNALLOCATED');
 await expect(page.getByRole('button',{name:'Export hardware candidate package'})).toBeDisabled();
 await expect(page.getByTestId('el-why')).toContainText('blocking');

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
