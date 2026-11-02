import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
// W06-T06 Gate B (pilot): the SOFTWARE-checkable parts only. Physical O01/O10/O11 with an approved, commissioned robot are blocked_external
// (docs/implementation/gates/B-pilot.md); nothing here may be read as a Gate B pass.
const coordinator='http://127.0.0.1:3451';
const baseline=JSON.parse(readFileSync(new URL('../fixtures/trial/site-baseline.json',import.meta.url),'utf8'));
const dossier=readFileSync(new URL('../../docs/implementation/gates/B-pilot.md',import.meta.url),'utf8');
const lab=()=>`pilot-${randomUUID().slice(0,8)}`;
const post=(page:import('@playwright/test').Page,id:string,type:string,payload:object,actor='manager')=>page.request.post(coordinator+'/commands',{headers:{'x-test-actor':actor,'x-test-lab':id},data:{type,payload,operationId:randomUUID()}}).then(r=>r.json());

test('one control source: only the robot\'s bound executor on its owner device observes, and stale epochs are refused',async({page})=>{
 const id=lab(),safety=(extra:object)=>({type:'safety_state',robotId:'sim-1',safetyState:'fault',controlEpoch:1,...extra});
 // another executor identity (not executor:sim-1) cannot speak for the robot
 expect((await post(page,id,'Robot.Observe',safety({}),'executor')).code).toBe('OBSERVER_NOT_BOUND');
 // the bound executor with an old control epoch is fenced out
 expect((await post(page,id,'Robot.Observe',safety({controlEpoch:0}),'executor:sim-1')).code).toBe('STALE_CONTROL_EPOCH');
 // a person (manager/cashier) cannot inject robot telemetry either
 expect((await post(page,id,'Robot.Observe',safety({}),'cashier')).code).toBe('FORBIDDEN');
 expect((await post(page,id,'Robot.Observe',safety({}),'manager')).code).toBe('FORBIDDEN');
 const robot=(await (await page.request.get(coordinator+'/snapshots',{headers:{'x-test-lab':id}})).json() as {ref:{kind:string;id:string};state:Record<string,unknown>}[]).find(s=>s.ref.kind==='robot'&&s.ref.id==='sim-1')!;
 expect(robot.state.safetyState).toBe('clear');
});

test('robots imported from the trial cannot be dispatched until commissioned and bound; the import creates no mission',async({page})=>{
 const id=lab();
 const preview=await post(page,id,'Trial.ImportPreview',{input:baseline});
 expect(preview.value.status).toBe('ready');
 expect((await post(page,id,'Trial.ImportApply',{input:baseline,previewHash:preview.value.previewHash})).status).toBe('accepted');
 const snapshots=async()=>(await (await page.request.get(coordinator+'/snapshots',{headers:{'x-test-lab':id}})).json() as {ref:{kind:string;id:string};version:number;state:Record<string,unknown>}[]);
 const r1=(await snapshots()).find(s=>s.ref.kind==='robot'&&s.ref.id==='R1')!;
 expect(r1.state).toMatchObject({driver:'valetudo',validation:'integration_tested',bindings:{}});
 for(const target of ['kitchen','table-1']){
  const refused=await post(page,id,'Mission.Create',{robotId:'R1',target},'cashier');
  expect(refused.status).toBe('rejected');expect(refused.code).toBe('VALIDATION_INSUFFICIENT');
 }
 // binding needs a map the robot itself reported; the importer cannot supply one
 const bind=await post(page,id,'Robot.BindMap',{robotId:'R1',mapId:'m',mapRevision:'1',frame:'map',units:'m',waypoints:{kitchen:{x:1,y:1}},expectedVersion:r1.version});
 expect(bind.code).toBe('MAP_NOT_REPORTED');
 expect((await snapshots()).filter(s=>['mission','robot-command'].includes(s.ref.kind))).toHaveLength(0);
});

test('the pilot dossier stays BLOCKED and carries the cutover checklist',()=>{
 expect(dossier).toMatch(/^Status: BLOCKED/m);
 expect(dossier).not.toMatch(/Status: (PASS|PASSED|VERIFIED)/i);
 for(const item of ['one control source','close or reconcile every open trial mission and bill','shadow mode is telemetry-only','W11','O01','O10','O11'])expect(dossier.toLowerCase()).toContain(item.toLowerCase());
});

test('real-device pilot (O01/O10/O11) with an approved commissioned robot',()=>{
 test.skip(!process.env.MEKONIQ_PILOT_DEVICE,'PREREQUISITE: a physical Android tablet pair, a commissioned hardware_validated/venue_approved robot, the venue LAN and a supervised operator; set MEKONIQ_PILOT_DEVICE to the signed device-session record. Without them Gate B stays BLOCKED.');
 // Even with the variable set there is no automated harness for supervised physical runs: refuse to report a pass.
 throw new Error('PREREQUISITE: O01/O10/O11 are supervised manual procedures recorded in docs/implementation/gates/B-pilot.md; no automated pass is possible.');
});
