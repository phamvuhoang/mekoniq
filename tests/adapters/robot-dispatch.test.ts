import { expect, test } from "vitest";
import type { JsonObject, Snapshot } from "../../packages/contracts/src/index";
import type { NativeExecutionState, RobotAdapter, RobotManifest } from "../../packages/robot-adapters/src/contract";
import { dispatchRobotEffects } from "../../packages/robot-adapters/src/dispatch";

/** In-memory outbox with the SqlStore claim/complete transitions (claim: pending→dispatching; complete: from dispatching/unknown). */
function outbox(rows: JsonObject[]) {
  const scope = {organizationId:"org-a",venueId:"venue-a"};
  const robot: Snapshot = {ref:{...scope,kind:"robot",id:"sim-1"},version:1,state:{controlEpoch:1}} as Snapshot;
  return {scope,rows,store:{
    effects:async()=>rows.map(r=>({...r})),
    claimEffect:async(_:unknown,id:string)=>{const r=rows.find(x=>x.id===id&&x.status==="pending");if(r){r.status="dispatching";r.attempts=Number(r.attempts??0)+1;}return Boolean(r);},
    completeEffect:async(_:unknown,id:string,status:string)=>{const r=rows.find(x=>x.id===id&&["dispatching","unknown"].includes(String(x.status)));if(r)r.status=status;},
    snapshots:async()=>[robot],
  }};
}
function adapter(over: Partial<RobotAdapter>): RobotAdapter & {calls:string[]} {
  const calls: string[] = [];
  const manifest = {id:"sim-1",validation:"simulated"} as RobotManifest;
  return {calls,describe:async()=>manifest,resolveTarget:async()=>{throw new Error("unused");},estimateReachability:async()=>({reachable:true}),
    execute:async()=>{throw new Error("unused");},cancel:async()=>({acknowledged:true,unknown:false}),requestStop:async()=>({acknowledged:true,physicalStopConfirmed:false}),
    observe:()=>()=>{},reconcile:async()=>({status:"unknown",evidence:{}}),...over} as RobotAdapter & {calls:string[]};
}

test("an unacknowledged STOP is resent every round until acknowledged, never sent to reconcile", async () => {
  const {store,scope,rows} = outbox([{id:"stop-1",type:"robot.requestStop",status:"pending",payload:{robotId:"sim-1",reason:"operator",controlEpoch:1}}]);
  const answers = [false,false,true];
  const a = adapter({});
  a.requestStop = async reason => {a.calls.push(`stop:${reason}`);return {acknowledged:answers.shift()!,physicalStopConfirmed:false};};
  a.reconcile = async id => {a.calls.push(`reconcile:${id}`);return {status:"unknown",evidence:{}} as NativeExecutionState;};
  await dispatchRobotEffects(store,scope,a,0);
  expect(rows[0]!.status).toBe("unknown");
  await dispatchRobotEffects(store,scope,a,0);
  expect(rows[0]!.status).toBe("unknown");
  await dispatchRobotEffects(store,scope,a,0);
  expect(rows[0]!.status).toBe("confirmed");
  await dispatchRobotEffects(store,scope,a,0);
  expect(a.calls).toEqual(["stop:operator","stop:operator","stop:operator"]);
});

test("a STOP left dispatching by a crash is resent", async () => {
  const {store,scope,rows} = outbox([{id:"stop-1",type:"robot.requestStop",status:"dispatching",payload:{robotId:"sim-1",reason:"operator",controlEpoch:1}}]);
  const a = adapter({});
  a.requestStop = async () => {a.calls.push("stop");return {acknowledged:true,physicalStopConfirmed:false};};
  await dispatchRobotEffects(store,scope,a,0);
  expect(a.calls).toEqual(["stop"]);
  expect(rows[0]!.status).toBe("confirmed");
});

test("an unresolved cancel whose goal is still executing is sent again, not confirmed; an ended goal confirms it", async () => {
  const {store,scope,rows} = outbox([{id:"cancel-1",type:"robot.cancel",status:"unknown",payload:{robotId:"sim-1",commandId:"cmd-1",controlEpoch:1}}]);
  let goal: NativeExecutionState["status"] = "executing";
  const a = adapter({});
  a.reconcile = async () => ({status:goal,evidence:{}});
  a.cancel = async id => {a.calls.push(`cancel:${id}`);return {acknowledged:false,unknown:true};};
  await dispatchRobotEffects(store,scope,a,0);
  expect(rows[0]!.status).toBe("unknown");
  expect(a.calls).toEqual(["cancel:cmd-1"]);
  goal = "cancelled";
  await dispatchRobotEffects(store,scope,a,0);
  expect(rows[0]!.status).toBe("confirmed");
  expect(a.calls).toEqual(["cancel:cmd-1"]);
});

test("an unresolved execute is still settled by reconcile only (a goto is never resent)", async () => {
  const {store,scope,rows} = outbox([{id:"cmd-1",type:"robot.execute",status:"unknown",payload:{robotId:"sim-1",commandId:"cmd-1",controlEpoch:1}}]);
  const a = adapter({});
  a.reconcile = async id => {a.calls.push(`reconcile:${id}`);return {status:"executing",evidence:{}};};
  a.execute = async () => {a.calls.push("execute");return {accepted:true,unknown:false};};
  await dispatchRobotEffects(store,scope,a,0);
  expect(a.calls).toEqual(["reconcile:cmd-1"]);
  expect(rows[0]!.status).toBe("confirmed");
});
