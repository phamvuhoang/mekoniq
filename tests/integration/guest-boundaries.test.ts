import { expect, test } from "vitest";
import { createRestaurantLab } from "../support/restaurant-lab";
import { completeSimulatedTravel, createSimulator } from "../support/restaurant-journey";
import { decodeGuestToken, guestCommand as guestEnvelope } from "../../packages/domain/src/service/guest-token";
import type { JsonObject } from "../../packages/contracts/src/index";
test("an old QR token cannot order for the next table occupant", async () => {
  const lab = await createRestaurantLab();
  try {
    await lab.command("cashier","Session.Open",{sessionId:"session-1",tableId:"table-1"});
    const token = await lab.guestToken("session-1");
    await lab.command("cashier","Session.Close",{sessionId:"session-1"});
    await lab.command("cashier","Session.Open",{sessionId:"session-2",tableId:"table-1"});
    expect((await lab.guestCommand(token,"Order.Place",{items:[{itemId:"tea",quantity:"1"}]})).code)
      .toBe("SESSION_EXPIRED");
  } finally { await lab.close(); }
});

type Lab=Awaited<ReturnType<typeof createRestaurantLab>>;
const tea={items:[{itemId:"tea",quantity:"1"}],menuVersion:1};
async function features(lab:Lab,changes:Record<string,string>) {
  const applied=await lab.state<JsonObject>("configuration","applied"),next={...(applied.features as JsonObject)};
  for(const [key,status] of Object.entries(changes)) next[key]={status,revision:1};
  await lab.seed("configuration","applied",{...applied,features:next});
}
async function open(lab:Lab,sessionId:string,tableId="table-1") {
  expect((await lab.command("cashier","Session.Open",{sessionId,tableId})).status).toBe("accepted");
}
async function arrive(lab:Lab,missionId:string,simulator:Awaited<ReturnType<typeof createSimulator>>) {
  await completeSimulatedTravel(lab,simulator,missionId);
  return lab.state<{version:number;revision:number;currentStopId:string;status:string;loaded:boolean;stops:JsonObject[]}>("mission",missionId);
}
async function confirm(lab:Lab,missionId:string) {
  const m=await lab.state<{version:number;revision:number;currentStopId:string}>("mission",missionId);
  return lab.command("cashier","Mission.ConfirmStop",{missionId,expectedVersion:m.version,missionRevision:m.revision,stopId:m.currentStopId});
}

test("a guest order uses the token's session and table, never payload ids or coupons", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"session-1");await open(lab,"session-2","table-2");
    const token=await lab.guestToken("session-1");
    const placed=await lab.guestCommand(token,"Order.Place",{...tea,sessionId:"session-2",tableId:"table-2",discountIds:["staff-50"]});
    expect(placed.status).toBe("accepted");expect(placed.value.sessionId).toBe("session-1");
    const order=await lab.state<{sessionId:string;tableId:string;channel:string;guestTokenId:string;totalMinor:string}>("order",String(placed.value.orderId));
    expect(order).toMatchObject({sessionId:"session-1",tableId:"table-1",channel:"qr",guestTokenId:decodeGuestToken(token).id,totalMinor:"20000"});
    expect(await lab.count("KitchenTicketCreated")).toBe(1);
    expect((await lab.state<{orderIds:string[]}>("session","session-2")).orderIds).toEqual([]);
    // The venue verifies the coordinator signature: an edited capability is not a token.
    const forged=decodeGuestToken(token);forged.sessionId="session-2";
    expect((await lab.command("guest","Guest.PlaceOrder",{...tea,guestToken:forged})).code).toBe("GUEST_TOKEN_INVALID");
    expect((await lab.command("guest","Guest.PlaceOrder",tea)).code).toBe("GUEST_TOKEN_REQUIRED");
    expect((await lab.guestCommand("not-a-token-at-all","Order.Place",tea)).code).toBe("GUEST_TOKEN_INVALID");
    await lab.advance(12*3600000);
    expect((await lab.guestCommand(token,"Order.Place",tea)).code).toBe("GUEST_TOKEN_EXPIRED");
  } finally { await lab.close(); }
});

test("move, merge and bill close all invalidate tokens bound to the old seating", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"moved");const moved=await lab.guestToken("moved");
    const before=await lab.state<{version:number}>("session","moved");
    expect((await lab.command("cashier","Session.Move",{sessionId:"moved",toTableId:"table-2",expectedVersion:before.version})).status).toBe("accepted");
    expect((await lab.guestCommand(moved,"Order.Place",tea)).code).toBe("SESSION_EXPIRED");
    expect((await lab.guestCommand(await lab.guestToken("moved"),"Order.Place",tea)).status).toBe("accepted");

    await open(lab,"source");const source=await lab.guestToken("source");
    const [s,t]=await Promise.all([lab.state<{version:number}>("session","source"),lab.state<{version:number}>("session","moved")]);
    expect((await lab.command("cashier","Session.Merge",{sourceSessionId:"source",targetSessionId:"moved",expectedSourceVersion:s.version,expectedTargetVersion:t.version})).status).toBe("accepted");
    expect((await lab.guestCommand(source,"Guest.CallStaff",{})).code).toBe("SESSION_EXPIRED");

    const target=await lab.guestToken("moved");
    expect((await lab.command("cashier","Shift.Open",{shiftId:"shift-g",currency:"VND",openingMinor:"0"})).status).toBe("accepted");
    const bill=await lab.command("cashier","Bill.Prepare",{sessionId:"moved"});expect(bill.status).toBe("accepted");
    expect((await lab.command("cashier","Payment.RecordCash",{billId:String(bill.value.billId),expectedVersion:1,amountMinor:"20000",shiftId:"shift-g"})).status).toBe("accepted");
    expect((await lab.command("cashier","Bill.Close",{billId:String(bill.value.billId),expectedVersion:2})).status).toBe("accepted");
    expect((await lab.guestCommand(target,"Guest.CallStaff",{})).code).toBe("SESSION_EXPIRED");
    expect((await lab.state<{revision:number;status:string}>("session","moved"))).toMatchObject({status:"closed"});
  } finally { await lab.close(); }
});

test("Session.Close only ends a seating with no live orders", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"busy");const token=await lab.guestToken("busy");
    const placed=await lab.guestCommand(token,"Order.Place",tea);
    expect((await lab.command("cashier","Session.Close",{sessionId:"busy"})).code).toBe("SESSION_HAS_ORDERS");
    expect((await lab.command("cashier","Order.Cancel",{orderId:String(placed.value.orderId),reason:"guest left",expectedVersion:1})).status).toBe("accepted");
    expect((await lab.command("cashier","Session.Close",{sessionId:"busy"})).status).toBe("accepted");
    expect((await lab.state<{activeSessionId:string|null}>("table","table-1")).activeSessionId).toBeNull();
    expect((await lab.command("guest","Session.Close",{sessionId:"busy"})).code).toBe("FORBIDDEN");
  } finally { await lab.close(); }
});

test("QR ordering can be off while staff POS ordering stays on, and kiosk is its own flag", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"session-1");const qr=await lab.guestToken("session-1"),kiosk=await lab.guestToken("session-1","kiosk");
    await features(lab,{"qr.order":"disabled"});
    expect((await lab.guestCommand(qr,"Order.Place",tea)).code).toBe("FEATURE_DISABLED");
    expect((await lab.command("cashier","Order.Place",{...tea,sessionId:"session-1",tableId:"table-1"})).status).toBe("accepted");
    const viaKiosk=guestEnvelope(kiosk,"Order.Place",tea);
    expect((await lab.command("kiosk",viaKiosk.type,viaKiosk.payload)).status).toBe("accepted");
    await features(lab,{"qr.order":"enabled","kiosk.order":"disabled"});
    expect((await lab.command("kiosk",viaKiosk.type,viaKiosk.payload)).code).toBe("FEATURE_DISABLED");
    expect((await lab.guestCommand(qr,"Order.Place",tea)).status).toBe("accepted");
  } finally { await lab.close(); }
});

test("robot-screen ordering follows the paired robot and is independent of robot delivery", async () => {
  const lab=await createRestaurantLab();
  try {
    await features(lab,{"robot.delivery":"disabled"});
    await open(lab,"session-1");
    expect((await lab.command("robot-display","Guest.PlaceOrder",tea)).code).toBe("GUEST_TOKEN_REQUIRED");
    expect((await lab.command("cashier","Robot.PairDisplay",{deviceId:"device-robot",robotId:"sim-1"})).code).toBe("FORBIDDEN");
    expect((await lab.command("manager","Robot.PairDisplay",{deviceId:"device-robot",robotId:"sim-1"})).status).toBe("accepted");
    expect((await lab.command("robot-display","Guest.PlaceOrder",tea)).code).toBe("ROBOT_NOT_AT_TABLE");
    const guide=await lab.command("cashier","Mission.Guide",{destinationId:"table-1",robotId:"sim-1"});expect(guide.status).toBe("accepted");
    expect((await arrive(lab,String(guide.value.missionId),await createSimulator(lab))).stops[0]).toMatchObject({action:"guide",targetId:"table-1",status:"awaiting_action"});
    // A payload naming another session/robot is ignored: the order lands on the table the paired robot is waiting at.
    const placed=await lab.command("robot-display","Guest.PlaceOrder",{...tea,sessionId:"other",robotId:"sim-9"});
    expect(placed.status).toBe("accepted");
    expect(await lab.state<JsonObject>("order",String(placed.value.orderId))).toMatchObject({sessionId:"session-1",channel:"robot",robotId:"sim-1"});
    expect((await lab.command("cashier","Mission.Create",{allocationIds:[]})).code).toBe("FEATURE_DISABLED");
    await features(lab,{"robot.delivery":"enabled","robot.order":"disabled"});
    expect((await lab.command("robot-display","Guest.PlaceOrder",tea)).code).toBe("FEATURE_DISABLED");
  } finally { await lab.close(); }
});

test("guests cannot settle payments, clear robot safety or reach staff commands", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"session-1");const token=await lab.guestToken("session-1");
    await lab.guestCommand(token,"Order.Place",tea);
    const bill=await lab.command("cashier","Bill.Prepare",{sessionId:"session-1"});expect(bill.status).toBe("accepted");
    const billId=String(bill.value.billId);
    for(const [type,payload] of [["Payment.RecordCash",{billId,amountMinor:"20000",expectedVersion:1}],["Bill.Close",{billId,expectedVersion:1}],["Robot.Reconcile",{robotId:"sim-1",proof:{}}],["Robot.PrepareReconciliation",{robotId:"sim-1"}],["Guest.AcknowledgeCall",{callId:"x"}],["Guest.IssueToken",{sessionId:"session-1"}],["Payment.VerifyManual",{billId}]] as [string,JsonObject][]) {
      expect((await lab.guestCommand(token,type,payload)).code).toBe("GUEST_COMMAND_FORBIDDEN");
      expect((await lab.command("guest",type,{...payload,guestToken:decodeGuestToken(token)})).code).toBe("FORBIDDEN");
    }
    const requested=await lab.guestCommand(token,"Guest.RequestBill",{billId,amountMinor:"20000"});
    expect(requested.status).toBe("accepted");expect(requested.value.billId).toBeUndefined();
    expect(await lab.state<JsonObject>("bill",billId)).toMatchObject({status:"prepared",paidMinor:"0"});
    expect(await lab.count("CashRecorded")+await lab.count("BillClosed")).toBe(0);
  } finally { await lab.close(); }
});

test("acknowledging a bill request never closes or settles the bill", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"session-1");const token=await lab.guestToken("session-1");
    await lab.guestCommand(token,"Order.Place",tea);
    const bill=await lab.command("cashier","Bill.Prepare",{sessionId:"session-1"});
    const call=await lab.guestCommand(token,"Guest.RequestBill",{});expect(call.status).toBe("accepted");
    const callId=String(call.value.callId);
    expect(await lab.state<JsonObject>("service-call",callId)).toMatchObject({kind:"bill",status:"open",sessionId:"session-1",tableId:"table-1"});
    expect((await lab.command("cashier","Guest.AcknowledgeCall",{callId,expectedVersion:1})).status).toBe("accepted");
    expect((await lab.command("cashier","Guest.AcknowledgeCall",{callId,expectedVersion:2})).code).toBe("CALL_ACKNOWLEDGED");
    expect(await lab.state<JsonObject>("service-call",callId)).toMatchObject({status:"acknowledged",acknowledgedBy:"cashier"});
    expect(await lab.state<JsonObject>("bill",String(bill.value.billId))).toMatchObject({status:"prepared",paidMinor:"0",version:1});
    expect(await lab.state<JsonObject>("session","session-1")).toMatchObject({status:"open"});
    expect(await lab.count("BillClosed")).toBe(0);
  } finally { await lab.close(); }
});

test("service calls coalesce per session and kind, honour a cooldown and replay idempotently", async () => {
  const lab=await createRestaurantLab();
  try {
    await open(lab,"session-1");await open(lab,"session-2","table-2");
    const token=await lab.guestToken("session-1"),other=await lab.guestToken("session-2");
    const first=await lab.guestCommand(token,"Guest.CallStaff",{reason:"water"},"call-op-1");
    expect(first.value).toMatchObject({coalesced:false});const callId=String(first.value.callId);
    const replay=await lab.guestCommand(token,"Guest.CallStaff",{reason:"water"},"call-op-1");
    expect(replay.duplicate).toBe(true);expect(replay.value.callId).toBe(callId);
    expect((await lab.guestCommand(token,"Guest.CallStaff",{})).value).toMatchObject({callId,coalesced:true,cooldown:true});
    expect((await lab.state<{count:number}>("service-call",callId)).count).toBe(1);
    await lab.advance(31000);
    expect((await lab.guestCommand(token,"Guest.CallStaff",{})).value).toMatchObject({callId,coalesced:true});
    expect((await lab.state<{count:number}>("service-call",callId)).count).toBe(2);
    // Another session and another kind are separate alerts.
    expect((await lab.guestCommand(other,"Guest.CallStaff",{})).value.callId).not.toBe(callId);
    const issue=await lab.guestCommand(token,"Guest.ReportIssue",{category:"food",note:"cold soup"});
    expect(issue.value.callId).not.toBe(callId);
    expect(await lab.state<JsonObject>("service-call",String(issue.value.callId))).toMatchObject({kind:"issue",category:"food",note:"cold soup"});
    expect((await lab.guestCommand(token,"Guest.ReportIssue",{category:"weather"})).code).toBe("INVALID_CATEGORY");
    expect((await lab.command("cashier","Guest.AcknowledgeCall",{callId,expectedVersion:2})).status).toBe("accepted");
    await lab.advance(31000);
    expect((await lab.guestCommand(token,"Guest.CallStaff",{})).value.callId).not.toBe(callId);
    await features(lab,{"guest.call":"disabled"});
    expect((await lab.guestCommand(token,"Guest.CallStaff",{})).code).toBe("FEATURE_DISABLED");
    expect((await lab.guestCommand(token,"Guest.RequestBill",{})).status).toBe("accepted");
    // Robot/safety problem reports are not a commercial feature: the guest.call flag cannot silence them (coalescing still applies).
    expect((await lab.guestCommand(token,"Guest.ReportIssue",{category:"food"})).code).toBe("FEATURE_DISABLED");
    const robotIssue=await lab.guestCommand(token,"Guest.ReportIssue",{category:"robot",note:"robot blocked the aisle"});
    expect(robotIssue.value).toMatchObject({coalesced:false});
    expect((await lab.guestCommand(token,"Guest.ReportIssue",{category:"robot"})).value).toMatchObject({callId:robotIssue.value.callId,cooldown:true});
    expect((await lab.guestCommand(token,"Guest.ReportIssue",{category:"safety"})).status).toBe("accepted");
  } finally { await lab.close(); }
});

test("guide missions need a known destination and a guide-capable robot", async () => {
  const lab=await createRestaurantLab();
  try {
    expect((await lab.command("cashier","Mission.Guide",{destinationId:"table-99"})).code).toBe("UNKNOWN_DESTINATION");
    expect((await lab.command("cashier","Mission.Guide",{destinationId:"kitchen"})).code).toBe("UNKNOWN_DESTINATION");
    expect(await lab.count("RobotCommandIssued")).toBe(0);
    const robot=await lab.state<JsonObject>("robot","sim-1");
    await lab.seed("robot","sim-1",{...robot,capabilities:["delivery","bussing"]});
    expect((await lab.command("cashier","Mission.Guide",{destinationId:"table-1"})).code).toBe("NO_CAPABLE_ROBOT");
    await lab.seed("robot","sim-1",robot);
    const guided=await lab.command("cashier","Mission.Guide",{destinationId:"table-1"});
    expect(guided.status).toBe("accepted");expect(await lab.count("RobotCommandIssued")).toBe(1);
    expect(await lab.state<JsonObject>("mission",String(guided.value.missionId))).toMatchObject({kind:"guide",robotId:"sim-1"});
    await features(lab,{"robot.guide":"disabled"});
    expect((await lab.command("cashier","Mission.Guide",{destinationId:"table-2"})).code).toBe("FEATURE_DISABLED");
  } finally { await lab.close(); }
});

test("a loaded bussing mission routes a cancel to unload instead of abandoning the dishes", async () => {
  const lab=await createRestaurantLab();
  try {
    expect((await lab.command("cashier","Mission.Bus",{tableId:"table-1",unloadAt:"nowhere"})).code).toBe("UNKNOWN_DESTINATION");
    const simulator=await createSimulator(lab);
    const bus=await lab.command("cashier","Mission.Bus",{tableId:"table-1"});expect(bus.status).toBe("accepted");
    const missionId=String(bus.value.missionId);
    expect((await arrive(lab,missionId,simulator)).stops.map(s=>[s.action,s.targetId,s.status])).toEqual([["collect","table-1","awaiting_action"],["unload","wash","pending"]]);
    expect((await confirm(lab,missionId)).status).toBe("accepted");
    let m=await lab.state<{version:number;loaded:boolean;status:string;stops:JsonObject[]}>("mission",missionId);
    expect(m.loaded).toBe(true);
    // Cancel while the robot is driving the dishes to the wash station: the goal is cancelled, the unload stop is kept.
    const observe=async(type:string)=>{const x=await lab.state<{commandId:string;commandRevision:number}>("mission",missionId);return lab.command("owner","Robot.Observe",{robotId:"sim-1",missionId,controlEpoch:1,commandId:x.commandId,missionRevision:x.commandRevision,type});};
    expect((await observe("accepted")).status).toBe("accepted");
    m=await lab.state("mission",missionId);
    const cancel=await lab.command("cashier","Mission.Cancel",{missionId,expectedVersion:m.version});
    expect(cancel.status).toBe("accepted");expect((cancel.value.effects as JsonObject[])[0]).toMatchObject({type:"robot.cancel"});
    m=await lab.state("mission",missionId);
    expect(m).toMatchObject({status:"cancelling",loaded:true});
    expect(m.stops.map(s=>[s.action,s.status])).toEqual([["collect","completed"],["unload","pending"]]);
    // Once the robot reports the goal cancelled it is sent on to the unload point; only confirming the unload ends the mission.
    expect((await observe("cancelled")).status).toBe("accepted");
    m=await arrive(lab,missionId,simulator);
    expect(m.stops[1]).toMatchObject({action:"unload",targetId:"wash",status:"awaiting_action"});
    expect((await lab.command("cashier","Mission.Cancel",{missionId,expectedVersion:m.version})).code).toBe("UNLOAD_PENDING");
    expect((await confirm(lab,missionId)).status).toBe("accepted");
    expect(await lab.state<JsonObject>("mission",missionId)).toMatchObject({status:"cancelled",loaded:false});
    // Before anything is collected a bussing mission simply cancels.
    const idle=await lab.command("cashier","Mission.Bus",{tableId:"table-2"});
    const fresh=await lab.state<{version:number}>("mission",String(idle.value.missionId));
    expect((await lab.command("cashier","Mission.Cancel",{missionId:String(idle.value.missionId),expectedVersion:fresh.version})).status).toBe("accepted");
    expect(((await lab.state<{stops:JsonObject[]}>("mission",String(idle.value.missionId))).stops).every(s=>s.status==="skipped")).toBe(true);
  } finally { await lab.close(); }
});
