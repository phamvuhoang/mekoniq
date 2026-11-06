// SIM-06 / FD07: the zone bridge executes a boundary entry only on a GRANTED production reservation. An unknown holder (stop requested, link
// lost) keeps the zone; TTL never frees it; a waiting robot is promoted only by a release, and then enters exactly once.
// The worker boundary command is a recorder: it proves the bridge's gating, not Gazebo motion.
import {afterEach,expect,test} from 'vitest';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SourceSession} from '../../packages/lab-runtime/src/v2/session';
import {createZoneBridge} from '../../packages/lab-runtime/src/v2/backends/zone-bridge';
import {restaurant} from '../support/lab-v2';
const dirs:string[]=[];
afterEach(async()=>{for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
async function makeZoneRig(robotIds:string[]){
 const dir=await mkdtemp(join(tmpdir(),'lab-v2-zone-'));dirs.push(dir);await mkdir(join(dir,'run'));
 let t=Date.parse('2026-11-05T08:00:00Z');const nowMs=()=>t;
 const base=restaurant();
 const assetRef=(base.entities[0] as {assetRef:unknown}).assetRef;
 const project={...base,entities:robotIds.map(id=>({id,kind:'amr',assetRef})),world:{...base.world,points:[...base.world.points,{id:'bay-2',name:'Bay 2',kind:'parking',x:1,y:3}]}} as unknown as Parameters<typeof SourceSession.open>[3]['project'];
 const source=await SourceSession.open(join(dir,'run'),'run-z',nowMs,{project,robots:robotIds.map((id,i)=>({id,parkingId:['bay-1','bay-2'][i]!,trays:3})),stationIds:['pass']},true);
 const calls:{robotId:string;zoneId:string}[]=[];
 const bridge=createZoneBridge(source,{async enter(robotId,zoneId){calls.push({robotId,zoneId});}});
 let op=0;
 return {source,bridge,calls,
  requestEntry:(robotId:string,zoneId:string)=>bridge.requestEntry(robotId,zoneId),
  async grantAndLoseRobot(robotId:string,zoneId:string){
   expect((await bridge.requestEntry(robotId,zoneId)).status).toBe('granted');
   const r=await source.submit('Robot.RequestStop',{robotId,reason:'bridge lost'},`stop-${++op}`);expect(r.status).toBe('accepted'); // the holder is now unknown
  },
  entryExecuteCount:(robotId:string)=>calls.filter(c=>c.robotId===robotId).length,
  zoneOwner:(zoneId:string)=>bridge.zoneOwner(zoneId),
  advance(ms:number){t+=ms;},
  close:()=>source.close()};
}

test('unknown corridor holder prevents the other robot entering',async()=>{
 const rig=await makeZoneRig(['robot-1','robot-2']);
 try{
  await rig.grantAndLoseRobot('robot-1','corridor-a');
  expect(await rig.requestEntry('robot-2','corridor-a')).toEqual({status:'pending',reason:'ZONE_HELD_UNKNOWN'});
  expect(rig.entryExecuteCount('robot-2')).toBe(0);
  expect(await rig.zoneOwner('corridor-a')).toBe('robot-1');
  // TTL alone never frees an unknown holder
  rig.advance(10*60000);
  expect(await rig.requestEntry('robot-2','corridor-a')).toEqual({status:'pending',reason:'ZONE_HELD_UNKNOWN'});
  expect(rig.entryExecuteCount('robot-2')).toBe(0);
  expect(await rig.zoneOwner('corridor-a')).toBe('robot-1');
  expect(rig.entryExecuteCount('robot-1')).toBe(1);
 }finally{await rig.close();}
});

test('a release by the known holder promotes the waiting robot, which then enters exactly once',async()=>{
 const rig=await makeZoneRig(['robot-1','robot-2']);
 try{
  expect((await rig.requestEntry('robot-1','corridor-a')).status).toBe('granted');
  expect((await rig.requestEntry('robot-2','corridor-a')).status).toBe('pending'); // simulator profile without zone enforcement: serialized
  expect(rig.entryExecuteCount('robot-2')).toBe(0);
  const released=await rig.bridge.release('robot-1','corridor-a');
  expect(released.promoted).toEqual(['corridor-a@robot-2']);
  expect(rig.entryExecuteCount('robot-2')).toBe(1);
  expect(await rig.zoneOwner('corridor-a')).toBe('robot-2');
  // asking again while granted only renews; no second boundary command
  expect((await rig.requestEntry('robot-2','corridor-a')).status).toBe('granted');
  expect(rig.entryExecuteCount('robot-2')).toBe(1);
  // another robot's executor cannot release a zone it does not hold
  expect((await rig.bridge.release('robot-1','corridor-a')).promoted).toEqual([]);
  expect(await rig.zoneOwner('corridor-a')).toBe('robot-2');
 }finally{await rig.close();}
});
