import {afterEach,expect,test} from 'vitest';
import {act,cleanupRuns,coffeeProject,openFixture,openCoffee,restaurant,stepUntil} from '../support/lab-v2';
import {scenarioRegistry} from '../../packages/lab-runtime/src/v2/scenario-registry';
import {hashJson} from '../../packages/lab-runtime/src/v2/hash';
afterEach(cleanupRuns);

test('restoring an untouched removed cup requires a real bound observation and then allows the existing job to complete',async()=>{
 const run=await openCoffee('BV01',{seed:42});
 try{
  await run.start();await stepUntil(run,v=>v.coffee!.jobs.some(j=>j.status==='cup_verified'),1);
  const removed=await act(run,'injectFault',{faultId:'cup-removed'}),job=removed.coffee!.jobs[0]!;
  expect(job).toMatchObject({status:'reserved',canRestoreCup:true});
  const restored=await act(run,'restoreCup',{subjectId:job.jobId});expect(restored.coffee!.jobs[0]).toMatchObject({status:'cup_verified',canRestoreCup:false});
  await stepUntil(run,undefined,500);const r=await run.report();expect(r.outcome).toMatchObject({status:'completed',served:'2'});
  await expect(act(run,'restoreCup',{subjectId:job.jobId})).rejects.toThrow('CUP_RESTORE_UNSAFE');
  expect((await run.snapshot()).run.status).toBe('completed');
 }finally{await run.close();}
});

test('project speed limit reaches mission admission and the plant, while the run keeps immutable inputs',async()=>{
 const normal=await openFixture('FD01',{seed:42}),project=restaurant();Object.assign(project.entities[0]!,{speedLimitMps:0.25});
 let slow:Awaited<ReturnType<typeof openFixture>>|undefined;
 try{
  slow=await openFixture('FD01',{seed:42,project});Object.assign(project.entities[0]!,{speedLimitMps:0.5});
  await normal.start();await slow.start();const a=await act(normal,'step',{ticks:250}),b=await act(slow,'step',{ticks:250});
  // The grid path turns within a tick; chord-distance integration can differ by less than one millimetre.
  expect(b.entities[0]!.distanceM).toBeCloseTo(a.entities[0]!.distanceM/2,3);
  const r=await slow.report();expect(r.effects.find(e=>e.type==='robot.execute')?.payload.limits).toMatchObject({speedLimitMps:0.25});
  expect(r.manifest.project.hash).not.toBe((await normal.report()).manifest.project.hash);
 }finally{await normal.close();await slow?.close();}
});

test('coffee manifest locks every design, recipe, model, adapter and illustrative profile without implying calibration',async()=>{
 const project=coffeeProject(),original=structuredClone(project),run=await openCoffee('BV01',{seed:42,project});
 let changed:Awaited<ReturnType<typeof openCoffee>>|undefined;
 try{
  const {manifest:m}=await run.report();
  expect(m).toMatchObject({hashAlgorithm:'sha256-canonical-json-v1',designHash:expect.stringMatching(/^[a-f0-9]{64}$/),adapterHash:expect.stringMatching(/^[a-f0-9]{64}$/),configuration:{revision:1,hash:expect.stringMatching(/^[a-f0-9]{64}$/)},calibration:{status:'not_calibrated',revision:null,hash:null}});
  expect(m.assets).toHaveLength(3);expect(m.recipes.map(r=>r.id)).toEqual(['espresso','iced-milk-coffee']);
  expect(m.models.map(x=>x.id)).toEqual(expect.arrayContaining(['mock_amr','mock_coffee','puma560-reference']));
  const profile=original.armCollisionProfile,scene=m.armCollisionScene!;
  expect(m.profiles).toEqual([{id:'mock-runtime',revision:1,hash:m.configuration.hash,provenance:'illustrative'},
   {id:profile.id,revision:profile.revision,hash:hashJson(profile),provenance:profile.provenance}]);
  expect(scene.profile).toEqual(profile);expect(scene.profileHash).toBe(hashJson(profile));expect(scene.world).toEqual(original.world);expect(scene.worldHash).toBe(hashJson(original.world));
  const {hash,...declaration}=scene;expect(hash).toBe(hashJson(declaration));expect(m.project.hash).toBe(hashJson(original));
  project.armCollisionProfile.revision++;project.armCollisionProfile.baseInMap.position[0]!+=0.1;
  await run.start();expect((await run.report()).manifest).toEqual(m);
  changed=await openCoffee('BV01',{seed:42,project});const next=(await changed.report()).manifest;
  expect(next.armCollisionScene!.profileHash).toBe(hashJson(project.armCollisionProfile));expect(next.armCollisionScene!.profileHash).not.toBe(scene.profileHash);
  expect(next.armCollisionScene!.hash).not.toBe(scene.hash);expect(next.configuration.hash).not.toBe(m.configuration.hash);expect(next.armCollisionScene!.worldHash).toBe(scene.worldHash);
 }finally{await run.close();await changed?.close();}
});

test('mutating a provider scenario after creation cannot change the locked run policy',async()=>{
 const definition=structuredClone(scenarioRegistry.get('FD01')!),scenarios={FD01:definition},run=await openFixture('FD01',{seed:42,scenarios});
 try{
  const before=(await run.report()).manifest;definition.confirm.mode='human';definition.orders=[];definition.park=false;
  await run.start();const view=await stepUntil(run,v=>v.awaiting.length>0||['completed','needs_attention'].includes(v.run.status),500);
  expect(view.run.status).toBe('completed');expect((await run.report()).manifest).toEqual(before);
 }finally{await run.close();}
});

async function observationsDoNotDuplicate(faultId:'reorder-observations'|'delay-observation'){
 const run=await openFixture('FD01',{seed:42});
 try{
  await run.start();await act(run,'injectFault',{faultId});await stepUntil(run,undefined,500);
  const r=await run.report();expect(r.outcome).toMatchObject({status:'completed',served:'1'});
  expect(r.effects.filter(e=>e.type==='robot.execute').map(e=>e.attempts)).toEqual([1,1,1]);
  expect(r.businessEvents.filter(e=>e.type==='DeliveryHandedOff')).toHaveLength(1);
  if(faultId==='reorder-observations')expect(r.businessEvents.find(e=>e.type==='RobotCommandObserved')!.state.status).toBe('completed');
  else expect(Date.parse(r.businessEvents.find(e=>e.type==='RobotGoalAccepted')!.at)-Date.parse(r.businessEvents.find(e=>e.type==='MissionCreated')!.at)).toBeGreaterThanOrEqual(2000);
 }finally{await run.close();}
}
test('reorder-observations keeps one served item and does not repeat execution',()=>observationsDoNotDuplicate('reorder-observations'));
test('delay-observation keeps one served item and does not repeat execution',()=>observationsDoNotDuplicate('delay-observation'));

test('a persistent transient coffee interlock escalates within the declared mock policy instead of waiting forever',async()=>{
 const run=await openCoffee('BV01',{seed:42});
 try{
  await run.start();await act(run,'injectFault',{faultId:'machine-not-ready'});
  let v=await run.snapshot();
  for(let i=0;i<80&&v.run.status!=='needs_attention';i++){await act(run,'injectFault',{faultId:'machine-not-ready'});v=await act(run,'step',{ticks:100});}
  expect(v.run.status).toBe('needs_attention');expect(v.attention.map(a=>a.reason)).toContain('INTERLOCK_TIMEOUT');
  expect((await run.report()).coffee!.cellEffects.filter(e=>(e.payload as {capability?:string}).capability==='brew')).toHaveLength(0);
 }finally{await run.close();}
});

test('a robot that cannot dock times out pickup without departing or losing cup custody',async()=>{
 const fd=scenarioRegistry.get('BV01')!,scenarios={'BV-pickup':{...fd,id:'BV-pickup',coffee:{orders:[fd.coffee!.orders[0]!]}}};
 const run=await openCoffee('BV-pickup',{seed:42,scenarios});
 try{
  await run.start();await stepUntil(run,v=>v.coffee!.cups.some(c=>c.ownerKind==='arm')&&!v.entities[0]!.moving&&v.entities[0]!.pose.x===3&&v.entities[0]!.pose.y===1,1);
  await act(run,'injectFault',{faultId:'dock-offset'});
  const v=await stepUntil(run,undefined,500,15000);
  expect(v.attention.map(a=>a.reason)).toContain('PICKUP_TIMEOUT');expect(v.served).toBe('0');
  const r=await run.report();expect(r.businessEvents.map(e=>e.type)).not.toContain('CargoLoaded');expect(r.coffee!.cups[0]!.ownerKind).toBe('arm');
 }finally{await run.close();}
});
