import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {preset} from '../../packages/domain/src/policy/presets';
// W06-T06: the trial-service preset on the SAME build as the full restaurant. Only settings (Configuration.Apply) and the venue (import + fixture lab) change.
// Limitation (recorded in docs/implementation/trial-service-parity.md): the dev lab always starts from the restaurant fixture venue, so cloud enrollment of
// an EMPTY venue cannot be driven here; the real configuration commands (Trial.Import*, Configuration.Apply) are used instead.
const coordinator='http://127.0.0.1:3451';
const baseline=JSON.parse(readFileSync(new URL('../fixtures/trial/site-baseline.json',import.meta.url),'utf8'));
const demo=JSON.parse(readFileSync(new URL('../fixtures/trial/site-demo.json',import.meta.url),'utf8'));
type Snap={ref:{kind:string;id:string};version:number;state:Record<string,unknown>};
function harness(page:Page,lab=`trial-${randomUUID().slice(0,8)}`){
 const url=(path:string,actor='manager')=>`${path}?actor=${actor}&lab=${lab}`;
 const api=async(type:string,payload:object,actor='manager')=>(await page.request.post(coordinator+'/commands',{headers:{'x-test-actor':actor,'x-test-lab':lab},data:{type,payload,operationId:randomUUID()}})).json();
 const snapshots=async()=>(await page.request.get(coordinator+'/snapshots',{headers:{'x-test-lab':lab}})).json() as Promise<Snap[]>;
 return {
  lab,url,api,snapshots,
  async screen(path:string,actor='manager'){await page.goto(url(path,actor));await expect(page.getByRole('button',{name:/^(Làm mới|Refresh)$/})).toBeVisible();},
  /** Dry-run first, then apply with the preview's hash. */
  async importTrial(input:object){
   const preview=await api('Trial.ImportPreview',{input});
   expect(preview.status,JSON.stringify(preview)).toBe('accepted');
   if(preview.value.status!=='ready')return {preview:preview.value,applied:undefined};
   const applied=await api('Trial.ImportApply',{input,previewHash:preview.value.previewHash});
   return {preview:preview.value,applied};
  },
  /** Choose the preset: legacy flags -> independent keys -> one Configuration.Apply at the next revision. `extra` are further settings. */
  async choosePreset(flags:Record<string,boolean>,extra:string[]=[]){
   const current=(await snapshots()).find(s=>s.ref.kind==='configuration')!;
   const revision=Number(current.state.revision)+1,planned=preset('trial-service',flags);
   const features=Object.fromEntries(Object.entries(planned.features).map(([key,f])=>[key,{status:f.status==='enabled'||extra.includes(key)?'enabled':'disabled',revision}]));
   const applied=await api('Configuration.Apply',{revision,features});
   expect(applied.status,JSON.stringify(applied)).toBe('accepted');
   return {revision,enabled:Object.entries(features).filter(([,f])=>f.status==='enabled').map(([k])=>k).sort()};
  },
 };
}
const navPaths=async(page:Page)=>page.getByRole('navigation').locator('a').evaluateAll(links=>links.map(a=>new URL((a as HTMLAnchorElement).href).pathname));

test('baseline site (all legacy flags off): only the core trial functions are offered and disabled ones are refused',async({page})=>{
 const h=harness(page);
 const {preview,applied}=await h.importTrial(baseline);
 expect(preview.status).toBe('ready');expect(preview.liveEffects).toBe('none');
 expect(applied.status,JSON.stringify(applied)).toBe('accepted');
 const set=await h.choosePreset({callStaff:false,requestBill:false,guide:false,order:false,pay:false,busRobot:false});
 expect(set.enabled).toEqual(['fleet','fulfillment','robot.delivery']);
 // UI: robot functions are offered; POS, kitchen, checkout, cash, print, guest and kiosk surfaces are not
 await h.screen('/fleet');
 const paths=await navPaths(page);
 expect(paths).toEqual(expect.arrayContaining(['/fleet','/robot-setup']));
 for(const off of ['/pos','/kitchen','/checkout','/cash','/print','/guest-requests','/kiosk','/robot-screen'])expect(paths,off).not.toContain(off);
 await h.screen('/pos');
 await expect(page.getByRole('heading',{name:'Chức năng đang tắt'})).toBeVisible();
 // delivery-only venue (order=false): the robot's own screen stays (status and safety notice, as in the trial); only guest ordering is withheld
 expect((await h.api('Robot.PairDisplay',{deviceId:'device-robot',robotId:'sim-1'})).status).toBe('accepted');
 await h.screen('/robot-screen','robot-display');
 expect(await navPaths(page)).toContain('/robot-screen');
 await expect(page.getByRole('heading',{name:'Chức năng đang tắt'})).toHaveCount(0);
 await expect(page.getByText('Robot đang chờ.')).toBeVisible();
 const fault=await h.api('Robot.Observe',{type:'safety_state',robotId:'sim-1',safetyState:'fault',controlEpoch:1},'executor:sim-1');
 expect(fault.status,JSON.stringify(fault)).toBe('accepted');
 await h.screen('/robot-screen','robot-display');
 await expect(page.getByText('Robot đang dừng an toàn. Vui lòng gọi nhân viên.')).toBeVisible();
 // API: the same refusals regardless of what the UI shows
 const refused:Record<string,[string,object,string]>={
  session:['Session.Open',{sessionId:'s-1',tableId:'table-1'},'cashier'],
  shift:['Shift.Open',{},'cashier'],
  print:['Print.Request',{kind:'receipt'},'cashier'],
  bus:['Mission.Bus',{tableId:'table-1'},'cashier'],
  guide:['Mission.Guide',{tableId:'table-1'},'cashier'],
  call:['Guest.CallStaff',{},'guest'],
  bill:['Guest.RequestBill',{},'guest'],
  robotOrder:['Guest.PlaceOrder',{items:[{itemId:'rice',quantity:'1'}],menuVersion:1},'robot-display'],
 };
 for(const [name,[type,payload,actor]] of Object.entries(refused)){
  const r=await h.api(type,payload,actor);
  expect(r.status,name).toBe('rejected');expect(r.code,name).toBe('FEATURE_DISABLED');
 }
 // The imported robot is visible but NOT dispatchable: unknown map, no bindings, integration_tested only. Setup says why.
 await h.screen('/robot-setup');
 await expect(page.locator('article.record').filter({hasText:'R1'}).getByText('VALIDATION_INSUFFICIENT').first()).toBeVisible();
 const dispatch=await h.api('Mission.Create',{robotId:'R1',target:'table-1'},'cashier');
 expect(dispatch.status).toBe('rejected');expect(dispatch.code).toBe('VALIDATION_INSUFFICIENT');
 const snaps=await h.snapshots();
 expect(snaps.filter(s=>['mission','robot-command','order','bill','payment'].includes(s.ref.kind))).toHaveLength(0);
 // importing the same file again is refused, not doubled
 const again=await h.importTrial(baseline);
 expect(again.preview.blocking).toEqual([{path:'',code:'TRIAL_IMPORT_ALREADY_APPLIED'}]);
 expect((await h.snapshots()).filter(s=>s.ref.kind==='trial-import')).toHaveLength(1);
});

test('all legacy flags on (demo site): call, bill request, guide and robot ordering are offered, bussing and delivery are on, the rest stays off',async({page})=>{
 const h=harness(page);
 const {applied}=await h.importTrial(demo);
 expect(applied.status,JSON.stringify(applied)).toBe('accepted');
 const set=await h.choosePreset({callStaff:true,requestBill:true,guide:true,order:true,pay:true,busRobot:true});
 expect(set.enabled).toEqual(expect.arrayContaining(['guest.call','guest.bill','robot.guide','robot.order','payment.transfer.manual','robot.bussing','robot.delivery','fleet','catalog','sessions','billing','orders']));
 // out of the preset: inventory, procurement, loyalty, reservations, chain, online, providers
 for(const off of ['inventory','procurement','loyalty','reservations','chain','online','promotion','payment.provider','einvoice','payment.transfer','kiosk.order','pos.order','kitchen'])expect(set.enabled,off).not.toContain(off);
 await h.screen('/fleet');
 const paths=await navPaths(page);
 expect(paths).toEqual(expect.arrayContaining(['/fleet','/robot-setup','/guest-requests','/checkout']));
 for(const off of ['/pos','/kitchen','/cash','/print','/kiosk'])expect(paths,off).not.toContain(off);
 // the robot's own screen (guest.order holder) is offered because robot.order is on
 await h.screen('/robot-screen','robot-display');
 expect(await navPaths(page)).toContain('/robot-screen');
 // staff seat a table; the call/bill request alerts work for that guest only
 expect((await h.api('Session.Open',{sessionId:'trial-seat',tableId:'table-1'},'cashier')).status).toBe('accepted');
 await h.screen('/guest-requests');
 const seat=page.locator('article.record').filter({hasText:'Bàn 01'}).filter({has:page.getByRole('button',{name:'Tạo link QR cho khách',exact:true})});
 await seat.getByRole('button',{name:'Tạo link QR cho khách',exact:true}).click();
 const link=seat.locator('code').filter({hasText:'/table/'});await expect(link).toBeVisible();
 const guestToken=JSON.parse(Buffer.from(String(await link.textContent()).replace('/table/',''),'base64url').toString());
 expect((await h.api('Guest.CallStaff',{guestToken,reason:'thêm chén'},'guest')).status).toBe('accepted');
 expect((await h.api('Guest.RequestBill',{guestToken},'guest')).status).toBe('accepted');
 // the QR ordering channel is a different flag and stays off in trial-service
 const qr=await h.api('Guest.PlaceOrder',{items:[{itemId:'rice',quantity:'1'}],menuVersion:1,guestToken},'guest');
 expect(qr.code).toBe('FEATURE_DISABLED');
 expect((await h.api('Order.Place',{sessionId:'trial-seat',items:[{itemId:'rice',quantity:'1'}]},'cashier')).code).toBe('FEATURE_DISABLED');
 await h.screen('/guest-requests');
 await expect(page.getByText('Gọi nhân viên').first()).toBeVisible();await expect(page.getByText('Yêu cầu thanh toán').first()).toBeVisible();
 // asking for the bill is an alert only
 const calls=(await h.snapshots()).filter(s=>s.ref.kind==='service-call');
 expect(calls.map(c=>c.state.kind).sort()).toEqual(['bill','staff']);
 expect((await h.snapshots()).filter(s=>['bill','payment'].includes(s.ref.kind))).toHaveLength(0);
 // the imported demo robots (R1..R3) are simulators with no map or binding: not dispatchable
 const dispatch=await h.api('Mission.Create',{robotId:'R2',target:'table-1'},'cashier');
 expect(dispatch.status).toBe('rejected');expect(['TARGET_UNBOUND','MAP_BINDING_STALE','CAPABILITY_UNSUPPORTED']).toContain(dispatch.code);
});

test('pay branch: a guest "I paid" claim never settles; only a manager attestation with a reference does',async({page})=>{
 const h=harness(page);
 // trial `pay` = staff-verified transfer -> payment.transfer.manual. qr.order is an extra setting so a bill can exist without a POS.
 await h.choosePreset({callStaff:true,requestBill:true,order:true,pay:true,busRobot:true},['qr.order']);
 expect((await h.api('Session.Open',{sessionId:'pay-seat',tableId:'table-1'},'cashier')).status).toBe('accepted');
 await h.screen('/guest-requests');
 const seat=page.locator('article.record').filter({hasText:'Bàn 01'}).filter({has:page.getByRole('button',{name:'Tạo link QR cho khách',exact:true})});
 await seat.getByRole('button',{name:'Tạo link QR cho khách',exact:true}).click();
 const link=seat.locator('code').filter({hasText:'/table/'});await expect(link).toBeVisible();
 const guestToken=JSON.parse(Buffer.from(String(await link.textContent()).replace('/table/',''),'base64url').toString());
 expect((await h.api('Guest.PlaceOrder',{items:[{itemId:'rice',quantity:'2'}],menuVersion:1,guestToken},'guest')).status).toBe('accepted');
 const prepared=await h.api('Bill.Prepare',{sessionId:'pay-seat'},'cashier');
 expect(prepared.status,JSON.stringify(prepared)).toBe('accepted');
 const billId=String(prepared.value.billId),bill=async()=>(await h.snapshots()).find(s=>s.ref.kind==='bill'&&s.ref.id===billId)!;
 const total=String((await bill()).state.totalMinor);
 // the guest says "I paid": an unverified observation, nothing is paid
 const claim=await h.api('Payment.Claim',{billId,method:'transfer'},'guest');
 expect(claim.status,JSON.stringify(claim)).toBe('accepted');expect(claim.value.status).toBe('unverified');
 expect(String((await bill()).state.paidMinor)).toBe('0');expect((await bill()).state.status).not.toBe('closed');
 expect((await h.snapshots()).filter(s=>s.ref.kind==='payment')).toHaveLength(0);
 // neither the guest nor a cashier (no payment.verify) can turn it into money
 const attest=(version:number,actor:string)=>h.api('Payment.VerifyManual',{billId,expectedVersion:version,amountMinor:total,reference:{provider:'vcb',merchantId:'trial',transactionId:'FT-1'},reason:'bank app shows the credit',evidenceRef:'screenshot-1',claimId:claim.value.claimId},actor);
 expect((await attest((await bill()).version,'guest')).code).toBe('FORBIDDEN');
 expect((await attest((await bill()).version,'cashier')).code).toBe('FORBIDDEN');
 expect((await h.snapshots()).filter(s=>s.ref.kind==='payment')).toHaveLength(0);
 // a manager attestation is the production path: a captured manual payment, claim marked verified
 const verified=await attest((await bill()).version,'manager');
 expect(verified.status,JSON.stringify(verified)).toBe('accepted');
 const payments=(await h.snapshots()).filter(s=>s.ref.kind==='payment');
 expect(payments).toHaveLength(1);expect(payments[0]!.state).toMatchObject({method:'transfer',verification:'manual',status:'captured',verifiedBy:'manager',capturedMinor:total});
 expect(String((await bill()).state.paidMinor)).toBe(total);
 // a retry of the same bank reference is not paid twice
 const retry=await attest((await bill()).version,'manager');
 expect(retry.status).toBe('accepted');expect(retry.value.duplicate).toBe(true);
 expect((await h.snapshots()).filter(s=>s.ref.kind==='payment')).toHaveLength(1);
 // the bank-integrated tender (payment.transfer, readiness bank) is off in trial-service
 const set=(await h.snapshots()).find(s=>s.ref.kind==='configuration')!.state.features as Record<string,{status:string}>;
 expect(set['payment.transfer']!.status).toBe('disabled');
});
