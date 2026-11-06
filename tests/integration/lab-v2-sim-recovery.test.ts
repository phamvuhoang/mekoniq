// SIM-07 / SYS02: losing the bridge after a send is an unknown outcome. Cargo, reservations and the mission stay held; a restarted worker is
// asked (reconcile) and never re-sent. Worker = protocol double with a durable command table (evidence `protocol_double`).
import {afterEach,expect,test} from 'vitest';
import {cleanupSil,makeSilRig} from '../support/sil-rig';
afterEach(cleanupSil);
/** Delivery under way with cargo loaded, then the bridge loses the reply of the second leg's execute. (Object.assign keeps the rig's live getters.) */
async function makeClockRig(){
 const rig=await makeSilRig({nativeResult:'completed'});
 return Object.assign(rig,{
  async startAndLoseReply(){
   expect(await rig.startDelivery()).toEqual(['accepted']);
   expect(await rig.poll()).toEqual(['completed']);          // arrived at the kitchen (observation from the worker, not a timer)
   const m=await rig.missionSnapshot();
   const stop=(m.state.stops as {id:string;status:string}[]).find(s=>s.status==='awaiting_action')!;
   const r=await rig.submit('Mission.ConfirmStop',{missionId:m.ref.id,expectedVersion:m.version,missionRevision:m.state.revision,stopId:stop.id});
   expect(r.status).toBe('accepted');                        // cargo loaded; the table leg is issued
   rig.port.loseReply=true;
   expect(await rig.dispatch()).toEqual(['unknown']);        // sent, reply lost: unknown, never resent
  },
  async reconcile(){return rig.dispatch();},
  executeCalls(){return rig.port.executeCalls;},
  async missionStatus(){return String((await rig.mission()).status);},
 });
}

test('bridge loss preserves cargo and never resends an uncertain execute',async()=>{
 const rig=await makeClockRig();
 try{
  await rig.startAndLoseReply();
  await rig.restartWorker();
  await rig.reconcile();
  expect(rig.executeCalls()).toBe(2);                        // kitchen leg + the one lost-reply send of the table leg; nothing after the restart
  expect(await rig.missionStatus()).toBe('needs_attention');
  expect(await rig.reservationStatus()).not.toBe('released');
  expect(await rig.allocationStatus()).toEqual(['loaded']);
  expect(await rig.fulfillmentServed()).toBe('0');
  const executes=(await rig.source.effects()).filter(e=>e.type==='robot.execute').map(e=>[e.status,e.attempts]);
  expect(executes).toEqual([['confirmed',1],['confirmed',1]]); // reconcile found the lost-reply goal executing on the server: confirmed, not re-sent
  // the restarted worker reports a new boot; the stale answer of the old boot cannot settle anything
  expect((await rig.backend.capability()).bootId).not.toBe('fake-boot-1');
 }finally{await rig.close();}
});

test('a worker that comes back without the goal keeps the mission unknown: reconcile audits, nothing is re-driven',async()=>{
 const rig=await makeClockRig();
 try{
  await rig.startAndLoseReply();
  rig.port.commands.clear();                                 // the action server forgot everything (crash); the durable table is empty
  await rig.restartWorker();
  await rig.reconcile();
  expect(rig.executeCalls()).toBe(2);
  expect(await rig.missionStatus()).toBe('needs_attention');
  const executes=(await rig.source.effects()).filter(e=>e.type==='robot.execute').map(e=>[e.status,e.attempts]);
  expect(executes).toEqual([['confirmed',1],['unknown',1]]);
  expect(await rig.adapter.reconcile(String((await rig.mission()).commandId))).toMatchObject({status:'unknown',evidence:{reason:'NOT_JOURNALED',evidence:'protocol_double'}});
 }finally{await rig.close();}
});
