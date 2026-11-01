import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import fixture from "../fixtures/restaurant-v1.json";
import type { JsonObject } from "../../packages/contracts/src/index";
import { validateRobotManifest } from "../../packages/contracts/src/validate";
import { eligibleRobots } from "../../packages/domain/src/fleet/admission";
import { robotSetupView } from "../../apps/tablet-web/src/screens/RobotSetup";
import { completeSimulatedTravel, createSimulator } from "../support/restaurant-journey";
import { dispatchRobotEffects, robotEventCommand } from "../../packages/robot-adapters/src/dispatch";
import type { RobotEvent } from "../../packages/robot-adapters/src/contract";

type Lab=Awaited<ReturnType<typeof createRestaurantLab>>;
const robot=(lab:Lab,id:string,o:JsonObject={})=>lab.seed("robot",id,{...structuredClone(fixture.robot) as JsonObject,id,...o});
const zone=async(lab:Lab,robotId:string,zoneId="aisle",o:JsonObject={})=>lab.command("executor","Zone.Reserve",{zoneId,robotId,...o});
async function features(lab:Lab,changes:Record<string,string>) {
  const applied=await lab.state<JsonObject>("configuration","applied"),next={...(applied.features as JsonObject)};
  for(const [key,status] of Object.entries(changes)) next[key]={status,revision:1};
  await lab.seed("configuration","applied",{...applied,features:next});
}

test("a known coordinate on a stale map is not dispatchable", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.seed("robot","sim-1",{mapRevision:"map-2",bindingRevision:"map-1",ready:true});
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1"})).code)
      .toBe("MAP_BINDING_STALE");
  } finally { await lab.close(); }
});

test("map reset makes every binding stale until an operator rebinds with explicit units and frame", async () => {
  const lab=await createRestaurantLab();
  try {
    // the executor reports a new map revision (relocalize/reset): same-size map, no identity proof -> stale
    await lab.seed("robot","sim-1",{mapRevision:"2"});
    expect((await lab.command("cashier","Mission.Create",{target:"table-1"})).code).toBe("NO_CAPABLE_ROBOT");
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1"})).code).toBe("MAP_BINDING_STALE");
    const r=await lab.state<JsonObject>("robot","sim-1");
    expect(eligibleRobots({stops:[{targetId:"table-1"}],capability:"delivery",trays:1},[{ref:{...lab.scope,kind:"robot",id:"sim-1"},version:1,state:r}])).toEqual([{robotId:"sim-1",eligible:false,reasons:["MAP_BINDING_STALE"]}]);
    const bind=(payload:Record<string,JsonObject[string]|undefined>,actor="manager")=>lab.command(actor,"Robot.BindMap",Object.fromEntries(Object.entries({robotId:"sim-1",mapId:"restaurant-map",mapRevision:"2",frame:"map",units:"cm",waypoints:{"table-1":{x:350,y:-20,yaw:1.5}},expectedVersion:r.version as number,...payload}).filter(([,v])=>v!==undefined)) as JsonObject);
    expect((await bind({},"cashier")).status).toBe("rejected");
    expect((await bind({units:undefined})).code).toBe("UNITS_REQUIRED");
    expect((await bind({frame:undefined})).code).toBe("FRAME_REQUIRED");
    expect((await bind({mapRevision:"1"})).code).toBe("MAP_NOT_REPORTED");
    expect((await bind({waypoints:{"table-9":{x:1,y:1}}})).code).toBe("UNKNOWN_POINT");
    expect((await bind({waypoints:{"table-1":{x:1,y:1,yaw:7}}})).code).toBe("INVALID_POSE");
    const bound=await bind({});
    expect(bound.status).toBe("accepted");
    const after=await lab.state<{bindingRevision:string;bindings:Record<string,JsonObject>}>("robot","sim-1");
    expect(after.bindingRevision).toBe("2");
    expect(after.bindings["table-1"]).toEqual({waypointId:"table-1",mapId:"restaurant-map",mapRevision:"2",frame:"map",x:3.5,y:-0.2,yaw:1.5});
    // table-1 is taught on the new map; kitchen is not, so a delivery that loads at the kitchen still is not dispatchable
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-1",stops:[{action:"collect",targetId:"kitchen"}]})).code).toBe("MAP_BINDING_STALE");
    const created=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1"});
    expect(created.status).toBe("accepted");
    const command=await lab.state<{target:JsonObject}>("robot-command",String(created.value.commandId));
    expect(command.target).toMatchObject({mapRevision:"2",x:3.5,y:-0.2});
  } finally { await lab.close(); }
});

test("profiles: unknown driver, non-validated hardware and simulator-only validation are not dispatchable", async () => {
  const lab=await createRestaurantLab();
  try {
    await robot(lab,"acme-1",{driver:"acme",validation:"hardware_validated"});
    await robot(lab,"ros-it",{driver:"ros2",validation:"integration_tested"});
    await robot(lab,"sim-hw",{validation:"hardware_validated"});
    await robot(lab,"ros-1",{driver:"ros2",validation:"hardware_validated"});
    expect((await lab.command("cashier","Mission.Create",{robotId:"acme-1",target:"table-1"})).code).toBe("UNKNOWN_DRIVER");
    expect((await lab.command("cashier","Mission.Create",{robotId:"ros-it",target:"table-1"})).code).toBe("VALIDATION_INSUFFICIENT");
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-hw",target:"table-1"})).code).toBe("VALIDATION_INSUFFICIENT");
    expect((await lab.command("cashier","Mission.Create",{robotId:"ros-1",target:"table-1"})).status).toBe("accepted");
    // readiness uses the same predicate: with only an integration_tested profile the robot features are not ready
    for(const id of ["sim-1","ros-1","sim-hw"]) await lab.seed("robot",id,{...structuredClone(fixture.robot) as JsonObject,id,driver:"ros2",validation:"integration_tested"});
    expect((await lab.command("cashier","Mission.Create",{target:"table-1"})).code).toBe("NOT_READY");
  } finally { await lab.close(); }
});

test("payload, speed, footprint and capability are checked for the chosen robot before scoring", async () => {
  const lab=await createRestaurantLab();
  try {
    expect((await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1",loadMinor:"20001"})).code).toBe("OVERLOADED");
    await robot(lab,"ros-1",{driver:"ros2",validation:"hardware_validated",speedControl:false,battery:90});
    expect((await lab.command("cashier","Mission.Create",{robotId:"ros-1",target:"table-1",speedLimitMps:0.3})).code).toBe("SPEED_UNSUPPORTED");
    // picking a specific robot does not bypass capability
    await lab.seed("robot","sim-1",{capabilities:["delivery"]});
    expect((await lab.command("cashier","Mission.Guide",{destinationId:"table-1",robotId:"sim-1"})).code).toBe("CAPABILITY_UNSUPPORTED");
    // a narrow aisle at table-2: the wide robot is filtered out, the 'any' choice goes to the narrow one
    await lab.seed("table","table-2",{...fixture.tables[1],clearanceM:0.55});
    await lab.seed("robot","sim-1",{footprint:{widthM:0.5,lengthM:0.5},battery:50});
    await lab.seed("robot","ros-1",{...structuredClone(fixture.robot) as JsonObject,id:"ros-1",driver:"ros2",validation:"hardware_validated",footprint:{widthM:0.7,lengthM:0.6},battery:90});
    expect((await lab.command("cashier","Mission.Create",{robotId:"ros-1",target:"table-2"})).code).toBe("FOOTPRINT_TOO_LARGE");
    const any=await lab.command("cashier","Mission.Create",{target:"table-2"});
    expect(any.status).toBe("accepted");
    expect((await lab.state<{robotId:string}>("mission",String(any.value.missionId))).robotId).toBe("sim-1");
    // unknown footprint never fits a constrained point
    const {footprint:_footprint,...noFootprint}=structuredClone(fixture.robot);void _footprint;
    await lab.seed("robot","ros-1",{...noFootprint as JsonObject,id:"ros-1",driver:"ros2",validation:"hardware_validated"});
    expect((await lab.command("cashier","Mission.Create",{robotId:"ros-1",target:"table-2"})).code).toBe("FOOTPRINT_UNKNOWN");
  } finally { await lab.close(); }
});

test("missing dock uses parking; a bound dock is preferred", async () => {
  const lab=await createRestaurantLab();
  try {
    expect((await lab.command("cashier","Mission.Create",{target:"home"})).code).toBe("ROBOT_REQUIRED");
    const home=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"home"});
    expect(home.status).toBe("accepted");
    expect((await lab.state<{stops:JsonObject[]}>("mission",String(home.value.missionId))).stops[0]).toMatchObject({targetId:"parking"});
    await lab.command("cashier","Mission.Cancel",{missionId:String(home.value.missionId),expectedVersion:1});
    await lab.seed("robot","sim-1",{chargingDock:"dock"});
    const unbound=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"home"});
    expect((await lab.state<{stops:JsonObject[]}>("mission",String(unbound.value.missionId))).stops[0]).toMatchObject({targetId:"parking"});
    const r=await lab.state<JsonObject>("robot","sim-1");
    expect((await lab.command("manager","Robot.BindMap",{robotId:"sim-1",mapId:"restaurant-map",mapRevision:"1",frame:"map",units:"m",waypoints:{dock:{x:6,y:0}},expectedVersion:r.version as number})).status).toBe("accepted");
    const docked=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"home"});
    expect((await lab.state<{stops:JsonObject[]}>("mission",String(docked.value.missionId))).stops[0]).toMatchObject({targetId:"dock"});
  } finally { await lab.close(); }
});

test("traffic zones: non-enforcing robots are serialized, mixed vendors stay pending, release promotes", async () => {
  const lab=await createRestaurantLab();
  try {
    await robot(lab,"sim-2",{zoneEnforcement:false});
    await robot(lab,"sim-3",{zoneEnforcement:true});
    await robot(lab,"ros-1",{driver:"ros2",validation:"hardware_validated",zoneEnforcement:true});
    await lab.seed("robot","sim-1",{zoneEnforcement:true});
    expect((await lab.command("cashier","Zone.Reserve",{zoneId:"aisle",robotId:"sim-1"})).status).toBe("rejected");
    const first=await zone(lab,"sim-1");
    expect(first.value).toMatchObject({status:"granted"});
    expect((await zone(lab,"sim-3")).value).toMatchObject({status:"granted"});
    expect((await zone(lab,"sim-2")).value).toMatchObject({status:"pending",reason:"ZONE_SERIALIZED"});
    expect((await zone(lab,"ros-1")).value).toMatchObject({status:"pending",reason:"MIXED_VENDOR_TRAFFIC"});
    expect(await lab.count("RobotCommandIssued")).toBe(0);
    // a holder asking again only renews; it is not downgraded behind the robots waiting for it
    expect((await zone(lab,"sim-1")).value).toMatchObject({status:"granted"});
    expect((await lab.command("executor","Zone.Release",{reservationId:String(first.value.reservationId)})).status).toBe("accepted");
    expect((await lab.state<{status:string}>("reservation","aisle@sim-2")).status).toBe("pending");
    const third=await lab.command("executor","Zone.Release",{reservationId:"aisle@sim-3"});
    expect(third.value).toMatchObject({promoted:["aisle@sim-2"]});
    expect((await lab.state<{status:string}>("reservation","aisle@sim-2")).status).toBe("granted");
    expect((await lab.state<{status:string;reason:string}>("reservation","aisle@ros-1"))).toMatchObject({status:"pending",reason:"MIXED_VENDOR_TRAFFIC"});
    expect((await lab.command("executor","Zone.Release",{reservationId:"aisle@sim-2"})).value).toMatchObject({promoted:["aisle@ros-1"]});
  } finally { await lab.close(); }
});

test("an unknown reservation is not released on TTL; a known idle holder lapses", async () => {
  const lab=await createRestaurantLab();
  try {
    await robot(lab,"sim-2");
    await robot(lab,"sim-3");
    expect((await zone(lab,"sim-1","aisle",{ttlMs:1000})).value).toMatchObject({status:"granted"});
    await lab.command("cashier","Robot.RequestStop",{robotId:"sim-1",reason:"staff_request"});
    await lab.advance(5000);
    expect((await zone(lab,"sim-2")).value).toMatchObject({status:"pending",reason:"ZONE_HELD_UNKNOWN"});
    expect((await lab.state<{status:string}>("reservation","aisle@sim-1")).status).toBe("unknown");
    expect((await lab.command("executor","Zone.Release",{reservationId:"aisle@sim-1"})).code).toBe("EVIDENCE_REQUIRED");
    // releasing on evidence is a manager decision: the executor cannot, and the evidence must not be blank
    expect((await lab.command("executor","Zone.Release",{reservationId:"aisle@sim-1",evidence:"robot says it left"})).status).toBe("rejected");
    expect((await lab.command("manager","Zone.Release",{reservationId:"aisle@sim-1",evidence:"   "})).code).toBe("EVIDENCE_REQUIRED");
    expect((await lab.state<{status:string}>("reservation","aisle@sim-1")).status).toBe("unknown");
    expect((await lab.command("manager","Zone.Release",{reservationId:"aisle@sim-1",evidence:"manager walked the aisle; robot parked at wash"})).value).toMatchObject({promoted:["aisle@sim-2"]});
    // sim-2 is idle (known) and its TTL passes: a new request takes the zone, the lapsed one is released, not left unknown
    await lab.advance(120000);
    expect((await zone(lab,"sim-3")).value).toMatchObject({status:"granted"});
    expect((await lab.state<JsonObject>("reservation","aisle@sim-2"))).toMatchObject({status:"released",releaseReason:"ttl_lapsed"});
  } finally { await lab.close(); }
});

test("fleet draining blocks new reservations but not releases; binding is configuration", async () => {
  const lab=await createRestaurantLab();
  try {
    const granted=await zone(lab,"sim-1");
    const open=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1"});
    await robot(lab,"sim-2");
    await features(lab,{fleet:"draining","robot.delivery":"disabled","robot.bussing":"disabled","robot.guide":"disabled"});
    expect((await zone(lab,"sim-1","bar-lane")).code).toBe("FEATURE_DRAINING");
    // finishing an open mission may still reserve, but only for the robot that mission belongs to
    expect((await zone(lab,"sim-2","bar-lane",{missionId:String(open.value.missionId)})).code).toBe("FEATURE_DRAINING");
    expect((await zone(lab,"sim-1","bar-lane",{missionId:String(open.value.missionId)})).value).toMatchObject({status:"granted"});
    expect((await lab.command("executor","Zone.Release",{reservationId:String(granted.value.reservationId)})).status).toBe("accepted");
    const r=await lab.state<JsonObject>("robot","sim-1");
    expect((await lab.command("manager","Robot.BindMap",{robotId:"sim-1",mapId:"restaurant-map",mapRevision:"1",frame:"map",units:"m",waypoints:{"table-2":{x:4,y:0.5}},expectedVersion:r.version as number})).status).toBe("accepted");
  } finally { await lab.close(); }
});

test("robot manifest schema carries the capability evidence eligibility needs", () => {
  const manifest={id:"ros-1",adapter:"ros2",protocolVersion:"nav2-jazzy-1",firmware:"jazzy-2026.10",capabilities:["delivery"],mapId:"m",mapRevision:"1",offlineExecution:true,maxLoadMinor:"20000",trays:2,validation:"hardware_validated",targetKind:"ros",units:"m",frame:"map",footprint:{widthM:0.5,lengthM:0.6},speedControl:true,maxSpeedMps:0.8,zoneEnforcement:false,docking:false};
  expect(validateRobotManifest(manifest)).toEqual(manifest);
  for(const change of [{validation:"assumed"},{units:"inch"},{footprint:{widthM:0}},{extra:true},{maxLoadMinor:"1.5"}])
    expect(()=>validateRobotManifest({...manifest,...change})).toThrow();
});

test("robot setup screen shows the same stale binding and profile reasons the scheduler uses", () => {
  const ref=(kind:string,id:string)=>({organizationId:"org",venueId:"venue",kind,id});
  const r={ref:ref("robot","r1"),version:1,state:{driver:"ros2",validation:"integration_tested",capabilities:["delivery"],mapId:"m",mapRevision:"2",bindingRevision:"1",parkingPoint:"parking",availability:"idle",battery:90,trays:2,bindings:{"table-1":{mapId:"m",mapRevision:"1"}}}};
  const [view]=robotSetupView([r,{ref:ref("table","table-1"),version:1,state:{name:"T1"}}]);
  expect(view!.profile).toBe("VALIDATION_INSUFFICIENT");
  expect(view!.points).toEqual([{id:"table-1",name:"T1",status:"MAP_BINDING_STALE"},{id:"parking",name:"parking",status:"MAP_BINDING_STALE"}]);
  expect(view!.eligibility.find(e=>e.capability==="guide")!.reasons).toEqual(["VALIDATION_INSUFFICIENT","CAPABILITY_UNSUPPORTED"]);
});

const mission=(lab:Lab,id:string)=>lab.state<{version:number;revision:number;currentStopId:string;status:string;attentionReason?:string;commandId:string;stops:JsonObject[];cancelRequestedAt?:string}>("mission",id);
const confirm=async(lab:Lab,id:string)=>{const m=await mission(lab,id);return lab.command("cashier","Mission.ConfirmStop",{missionId:id,expectedVersion:m.version,missionRevision:m.revision,stopId:m.currentStopId});};
const reportMap=async(lab:Lab,mapRevision:string)=>{const r=await lab.state<JsonObject>("robot","sim-1");await lab.seed("robot","sim-1",{...r,mapRevision});};
// journaled robot.execute intents (lab.effectCount counts dispatch attempts, not intents)
const executeIntents=async(lab:Lab)=>(await (await lab.getStore("coordinator")).effects(lab.scope,"robot.execute")).length;
const rebind=async(lab:Lab,mapRevision:string)=>{const r=await lab.state<JsonObject>("robot","sim-1");return lab.command("manager","Robot.BindMap",{robotId:"sim-1",mapId:"restaurant-map",mapRevision,frame:"map",units:"m",waypoints:{kitchen:{x:0,y:0},"table-1":{x:3,y:0}},expectedVersion:r.version as number});};
async function deliveryAtKitchen(lab:Lab) {
  await lab.command("cashier","Session.Open",{sessionId:"s-1",tableId:"table-1"});
  const placed=await lab.command("cashier","Order.Place",{sessionId:"s-1",tableId:"table-1",menuVersion:1,items:[{itemId:"rice",quantity:"1"}]});
  const lineId=(placed.value.lineIds as string[])[0]!;
  await lab.command("chef","Kitchen.Ready",{lineId,quantity:"1",stationId:"kitchen",expectedVersion:1});
  const allocation=await lab.command("cashier","Fulfillment.Allocate",{lineId,quantity:"1",expectedVersion:2,method:"robot"});
  const created=await lab.command("cashier","Mission.Create",{allocationIds:[String(allocation.value.allocationId)],robotId:"sim-1"});
  const missionId=String(created.value.missionId),simulator=await createSimulator(lab);
  await completeSimulatedTravel(lab,simulator,missionId);
  return {missionId,simulator,allocationId:String(allocation.value.allocationId)};
}

test("a robot reporting a new map mid-mission is held: confirmed cargo commits, no old-map leg is issued, rebind + resume continues", async () => {
  const lab=await createRestaurantLab();
  try {
    const {missionId,allocationId}=await deliveryAtKitchen(lab);
    await reportMap(lab,"2");
    const issued=await lab.count("RobotCommandIssued"),executes=await executeIntents(lab);
    const confirmed=await confirm(lab,missionId);
    expect(confirmed.status).toBe("accepted");
    expect(confirmed.value).toMatchObject({status:"needs_attention",reason:"MAP_BINDING_STALE"});
    expect((await lab.state<{status:string}>("allocation",allocationId)).status).toBe("loaded");
    const held=await mission(lab,missionId);
    expect(held).toMatchObject({status:"needs_attention",attentionReason:"MAP_BINDING_STALE"});
    expect(held.stops.find(s=>s.id===held.currentStopId)).toMatchObject({action:"handoff",status:"pending"});
    expect(await lab.state<JsonObject>("robot","sim-1")).toMatchObject({missionId,availability:"busy"});
    expect(await lab.count("RobotCommandIssued")).toBe(issued);
    expect(await executeIntents(lab)).toBe(executes);
    expect((await lab.command("cashier","Mission.Resume",{missionId,expectedVersion:held.version})).code).toBe("MAP_BINDING_STALE");
    expect((await rebind(lab,"2")).status).toBe("accepted");
    const resumed=await lab.command("cashier","Mission.Resume",{missionId,expectedVersion:held.version});
    expect(resumed.status).toBe("accepted");
    expect((await lab.state<{target:JsonObject}>("robot-command",String(resumed.value.commandId))).target).toMatchObject({waypointId:"table-1",mapRevision:"2"});
    expect(await mission(lab,missionId)).toMatchObject({status:"executing",attentionReason:null});
    expect(await lab.count("RobotCommandIssued")).toBe(issued+1);
  } finally { await lab.close(); }
});

test("a loaded cancel whose return leg is on a stale binding issues no execute until rebound", async () => {
  const lab=await createRestaurantLab();
  try {
    const {missionId,simulator}=await deliveryAtKitchen(lab);
    expect((await confirm(lab,missionId)).status).toBe("accepted"); // cargo loaded; the hand-off leg is issued on the current map
    const events:RobotEvent[]=[],stop=simulator.observe(e=>events.push(e));
    const post=async()=>{for(const e of events.splice(0)) expect((await lab.command("owner","Robot.Observe",robotEventCommand(e),e.id)).status).toBe("accepted");};
    await dispatchRobotEffects(await lab.getStore("coordinator"),lab.scope,simulator,lab.clock.nowMs);await post();
    const executing=await mission(lab,missionId);
    expect((await lab.command("cashier","Mission.Cancel",{missionId,expectedVersion:executing.version})).status).toBe("accepted");
    await dispatchRobotEffects(await lab.getStore("coordinator"),lab.scope,simulator,lab.clock.nowMs);
    await reportMap(lab,"2");
    const executes=await executeIntents(lab);
    await post();stop();
    const held=await mission(lab,missionId);
    expect(held).toMatchObject({status:"needs_attention",attentionReason:"MAP_BINDING_STALE"});
    expect(held.cancelRequestedAt).toBeTruthy();
    expect(held.stops.find(s=>s.id===held.currentStopId)).toMatchObject({action:"return",targetId:"kitchen",status:"pending"});
    expect(await executeIntents(lab)).toBe(executes);
    expect((await rebind(lab,"2")).status).toBe("accepted");
    const resumed=await lab.command("cashier","Mission.Resume",{missionId,expectedVersion:held.version});
    expect((await lab.state<{target:JsonObject}>("robot-command",String(resumed.value.commandId))).target).toMatchObject({waypointId:"kitchen",mapRevision:"2"});
    expect(await executeIntents(lab)).toBe(executes+1);
  } finally { await lab.close(); }
});

test("an admitted speed limit reaches every robot command: first leg, next leg and queued assignment", async () => {
  const lab=await createRestaurantLab();
  try {
    const a=await lab.command("cashier","Mission.Create",{robotId:"sim-1",stops:[{action:"standby",targetId:"table-1"},{action:"standby",targetId:"table-2"}],speedLimitMps:0.4});
    const limits=async(commandId:unknown)=>(await lab.state<{limits:JsonObject}>("robot-command",String(commandId))).limits;
    expect(await limits(a.value.commandId)).toEqual({trays:2,maxLoadMinor:"20000",speedLimitMps:0.4});
    const b=await lab.command("cashier","Mission.Create",{robotId:"sim-1",target:"table-1",speedLimitMps:0.3});
    expect(b.value).toMatchObject({status:"queued"});
    const missionId=String(a.value.missionId),simulator=await createSimulator(lab);
    await completeSimulatedTravel(lab,simulator,missionId);
    expect(await limits((await confirm(lab,missionId)).value.commandId)).toMatchObject({speedLimitMps:0.4});
    await completeSimulatedTravel(lab,simulator,missionId);
    const done=await confirm(lab,missionId);
    expect(done.value).toMatchObject({assignedMissionId:b.value.missionId});
    expect(await limits((await mission(lab,String(b.value.missionId))).commandId)).toMatchObject({speedLimitMps:0.3});
    expect((await lab.command("cashier","Mission.Create",{target:"table-1",stops:[{action:"standby",targetId:"table-2"}]})).code).toBe("AMBIGUOUS_MISSION");
    expect((await lab.command("cashier","Mission.Create",{target:"table-1",allocationIds:[]})).code).toBe("AMBIGUOUS_MISSION");
  } finally { await lab.close(); }
});
