import { deflateSync } from 'node:zlib';
import { describe, expect, test } from "vitest";
import { createValetudoRig, createValetudoServer, valetudoProfile } from "../support/valetudo-rig";
import { lanEndpoint, validateProfile } from "../../packages/robot-adapters/src/valetudo/capabilities";
import { arrivalConfirmed } from "../../packages/robot-adapters/src/valetudo/completion";
import { inflateMapData, MqttTransport } from "../../packages/robot-adapters/src/valetudo/mqtt";
import { RestTransport } from "../../packages/robot-adapters/src/valetudo/rest";
import { ValetudoAdapter } from "../../packages/robot-adapters/src/valetudo/adapter";
import { dispatchRobotEffects } from "../../packages/robot-adapters/src/dispatch";
import { driverRegistry, profileReason } from "../../packages/domain/src/fleet/capabilities";

test("HTTP 200 plus stale idle telemetry cannot mean arrival", async () => {
  const rig = await createValetudoRig();
  try {
    rig.server.acceptGoto();
    rig.server.telemetry({status:"idle",mapRevision:"old",observedAt:1});
    await rig.adapter.execute(rig.command("c-1"));
    expect(rig.events.filter(e=>e.type==="completed")).toHaveLength(0);
  } finally { await rig.close(); }
});

describe("valetudo REST conformance (protocol emulator, not a robot)", () => {
  test("HTTP 200 with the robot idle at the goal and no motion evidence stays pending, then unknown — never completed", async () => {
    const rig = await createValetudoRig();
    try {
      rig.server.idleAt(2500,1200); // already parked on the goal: idle samples alone prove nothing
      const ack=await rig.adapter.execute(rig.command("c-1"));
      expect(ack).toMatchObject({accepted:true,unknown:false});
      expect(rig.server.lab.gotos).toMatchObject([{x:2500,y:1200}]); // 25 m, 12 m -> cm
      for(let i=0;i<5;i++) await rig.tick(1000);
      expect(rig.types()).not.toContain("completed");
      expect(await rig.adapter.reconcile("c-1")).toMatchObject({status:"executing"});
      await rig.tick(120000);
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason:"NO_MOTION_EVIDENCE"}});
      expect(rig.types()).not.toContain("completed");
    } finally { await rig.close(); }
  });
  test("arrival needs motion toward our goal, the same map, a fresh stationary idle stretch within tolerance; completed is emitted once", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);
      expect(rig.types()).toEqual(["accepted","progress"]);
      rig.server.idleAt(2480,1210);await rig.tick(1000);
      expect(rig.types()).not.toContain("completed"); // stationary for 0 ms
      await rig.tick(2000);
      expect(rig.events.filter(e=>e.type==="completed")).toHaveLength(1);
      expect(rig.events.at(-1)).toMatchObject({type:"completed",commandId:"c-1",payload:{robotId:"valetudo-1",missionId:"mission-1",controlEpoch:1,transport:"rest"}});
      await rig.tick(1000);await rig.tick(1000);
      expect(rig.events.filter(e=>e.type==="completed")).toHaveLength(1);
      expect(await rig.adapter.reconcile("c-1")).toMatchObject({status:"completed"});
    } finally { await rig.close(); }
  });
  test("idle away from the goal, or without a pose, is never arrival", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);
      rig.server.idleAt(2300,1200);await rig.tick(1000);await rig.tick(3000);
      expect(rig.types()).not.toContain("completed");
      rig.server.telemetry({noPose:true,x:2500,y:1200});await rig.tick(1000);await rig.tick(3000);
      expect(rig.types()).not.toContain("completed");
      await rig.tick(120000);
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason:"NO_POSE"}});
    } finally { await rig.close(); }
  });
  test("stale telemetry (no fresh sample) never confirms arrival", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);rig.server.idleAt();await rig.tick(1000);
      rig.server.unreachable();await rig.tick(5000);
      expect(rig.types()).not.toContain("completed");
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason:"TELEMETRY_GAP"}});
    } finally { await rig.close(); }
  });
  test("reboot mid-trip: a telemetry gap then the robot at the goal is unknown, not completed", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);
      rig.advance(500);rig.server.reboot();rig.server.idleAt(2500,1200); // reboot faster than one poll: only host uptime shows it
      await rig.tick(1000);await rig.tick(3000);
      expect(rig.types()).not.toContain("completed");
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason:"REBOOTED"}});
      const seen = await createValetudoRig();
      try { // a reboot the poller does see: docked mid-trip
        await seen.adapter.execute(seen.command("c-1"));seen.server.driving();await seen.tick(1000);
        seen.server.reboot();await seen.tick(1000);seen.server.idleAt(2500,1200);await seen.tick(3000);
        expect(seen.types()).not.toContain("completed");expect(seen.events.at(-1)).toMatchObject({type:"unknown"});
      } finally { await seen.close(); }
    } finally { await rig.close(); }
  });
  test("map change or a foreign goal mid-trip is unknown", async () => {
    for(const [change,reason] of [[{mapRevision:"r2"},"MAP_CHANGED"],[{goToTarget:{x:900,y:900}},"GOAL_REPLACED"]] as const) {
      const rig = await createValetudoRig();
      try {
        await rig.adapter.execute(rig.command("c-1"));
        rig.server.driving();await rig.tick(1000);
        rig.server.telemetry(change);await rig.tick(1000);
        expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason}});
        expect(rig.types()).not.toContain("completed");
      } finally { await rig.close(); }
    }
  });
  test("no ACK (late or never answered) is unknown and the same goal is never sent twice", async () => {
    for(const mode of ["late","silent","fail"] as const) {
      const rig = await createValetudoRig();
      try {
        if(mode==="late") rig.server.acceptGoto({delayMs:800}); else if(mode==="silent") rig.server.silentGoto(); else rig.server.failGoto();
        expect(await rig.adapter.execute(rig.command("c-1"))).toMatchObject({accepted:false,unknown:true});
        expect(await rig.adapter.execute(rig.command("c-1"))).toMatchObject({accepted:false,unknown:true});
        expect(rig.server.gotoCount).toBe(1);
        rig.server.driving();await rig.tick(1000);rig.server.idleAt();await rig.tick(1000);await rig.tick(3000);
        expect(rig.types()).not.toContain("completed");
        expect(await rig.adapter.reconcile("c-1")).toMatchObject({status:"unknown"});
      } finally { await rig.close(); }
    }
  });
  test("same goal resend and duplicate delivery send one goto; a changed payload under the same id is a conflict", async () => {
    const rig = await createValetudoRig();
    try {
      const c=rig.command("c-1");
      expect(await rig.adapter.execute(c)).toMatchObject({accepted:true});
      expect(await rig.adapter.execute(structuredClone(c))).toMatchObject({accepted:true,unknown:false});
      expect(rig.server.gotoCount).toBe(1);
      await expect(rig.adapter.execute({...c,stopId:"other"})).rejects.toThrow("IDEMPOTENCY_CONFLICT");
      expect(rig.server.gotoCount).toBe(1);
    } finally { await rig.close(); }
  });
  test("unsupported speed limit, stale epoch, expiry, wrong map/frame and missing capability are refused before any I/O", async () => {
    const rig = await createValetudoRig();
    try {
      const target=rig.command("x").target;
      expect(await rig.adapter.execute(rig.command("s",{limits:{trays:1,maxLoadMinor:"5000",speedLimitMps:0.5}}))).toEqual({accepted:false,unknown:false,reason:"SPEED_UNSUPPORTED"});
      expect(await rig.adapter.execute(rig.command("e",{expiresAt:new Date(rig.clock.ms).toISOString(),issuedAt:new Date(rig.clock.ms-1000).toISOString()}))).toMatchObject({reason:"EXPIRED_COMMAND"});
      expect(await rig.adapter.execute(rig.command("m",{target:{...target,mapRevision:"r0"}}))).toMatchObject({reason:"MAP_MISMATCH"});
      expect(await rig.adapter.execute(rig.command("f",{target:{...target,frame:"map"}}))).toMatchObject({reason:"FRAME_MISMATCH"});
      expect(await rig.adapter.execute(rig.command("r",{robotId:"other"}))).toMatchObject({reason:"ROBOT_MISMATCH"});
      rig.server.lab.capabilities=["BasicControlCapability"];
      expect(await rig.adapter.execute(rig.command("cap"))).toMatchObject({reason:"CAPABILITY_UNSUPPORTED"});
      expect(rig.server.gotoCount).toBe(0);
    } finally { await rig.close(); }
    const next = await createValetudoRig();
    try {
      await next.adapter.execute(next.command("c-2",{controlEpoch:2}));
      next.server.driving();await next.tick(1000);next.server.idleAt();await next.tick(1000);await next.tick(2500);
      expect(next.types()).toContain("completed");
      expect(await next.adapter.execute(next.command("c-1",{controlEpoch:1}))).toMatchObject({accepted:false,reason:"STALE_CONTROL_EPOCH"});
      expect(next.server.gotoCount).toBe(1);
    } finally { await next.close(); }
  });
  test("STOP then retarget waits for stationary evidence, never a timer", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);
      expect(await rig.adapter.cancel("c-1")).toEqual({acknowledged:true,unknown:false});
      expect(rig.server.stopCount).toBe(1);
      expect(await rig.adapter.execute(rig.command("c-2",{stopId:"stop-2"}))).toMatchObject({accepted:false,reason:"PREVIOUS_GOAL_ACTIVE"});
      await rig.tick(30000); // time alone proves nothing: still moving
      expect(rig.types()).not.toContain("cancelled");
      rig.server.idleAt(2200,1400);await rig.tick(1000);await rig.tick(2500);
      expect(rig.events.at(-1)).toMatchObject({type:"cancelled",commandId:"c-1"});
      expect(await rig.adapter.execute(rig.command("c-2",{stopId:"stop-2"}))).toMatchObject({accepted:true});
      expect(rig.server.gotoCount).toBe(2);
      // Operator STOP: request ACK only, goals unknown, the next goal waits for stationary evidence after the stop.
      expect(await rig.adapter.requestStop("operator")).toEqual({acknowledged:true,physicalStopConfirmed:false});
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",commandId:"c-2",payload:{reason:"STOP_REQUESTED"}});
      expect(await rig.adapter.execute(rig.command("c-3",{stopId:"stop-3"}))).toMatchObject({accepted:false,reason:"STOP_UNCONFIRMED"});
      await rig.tick(1000);await rig.tick(2500);
      expect(await rig.adapter.execute(rig.command("c-3",{stopId:"stop-3"}))).toMatchObject({accepted:true});
    } finally { await rig.close(); }
  });
  test("robot error is failed plus a safety_state fault; recovery reports clear; an erroring robot gets no goto", async () => {
    const rig = await createValetudoRig();
    try {
      await rig.adapter.execute(rig.command("c-1"));
      rig.server.driving();await rig.tick(1000);
      rig.server.telemetry({status:"error",error:"Wheel stuck"});await rig.tick(1000);
      expect(rig.events.filter(e=>["safety_state","failed"].includes(e.type)).map(e=>[e.type,e.payload.safetyState ?? e.payload.reason])).toEqual([["safety_state","clear"],["safety_state","fault"],["failed","ROBOT_ERROR"]]);
      expect(rig.events.filter(e=>e.type==="safety_state").every(e=>e.commandId===""&&e.payload.controlEpoch===undefined)).toBe(true); // robot-level: the forwarder stamps the epoch
      expect(await rig.adapter.execute(rig.command("c-2",{stopId:"stop-2"}))).toMatchObject({accepted:false,reason:"ROBOT_ERROR"});
      expect(rig.server.gotoCount).toBe(1);
      rig.server.telemetry({status:"idle"});await rig.tick(1000);
      expect(rig.events.at(-1)).toMatchObject({type:"safety_state",payload:{safetyState:"clear"}});
    } finally { await rig.close(); }
  });
  test("after a reload with no command, the current robot state is reported and re-emitted until the domain accepts it", async () => {
    const rig = await createValetudoRig({ackSafety:false});
    try {
      rig.server.telemetry({status:"error",error:"Wheel stuck"});
      await rig.tick(1000);await rig.tick(1000);
      const faults=rig.events.filter(e=>e.type==="safety_state");
      expect(faults.map(e=>e.payload.safetyState)).toEqual(["fault","fault"]); // not latched: nothing accepted it yet
      rig.adapter.safetyAccepted("fault");await rig.tick(1000);
      expect(rig.events.filter(e=>e.type==="safety_state")).toHaveLength(2);
      rig.server.telemetry({status:"idle"});await rig.tick(1000);
      expect(rig.events.at(-1)).toMatchObject({type:"safety_state",payload:{safetyState:"clear"}});
    } finally { await rig.close(); }
  });
  test("a compressed map that inflates past the cap is rejected (REST gzip and MQTT deflate)", async () => {
    const rig = await createValetudoRig({profile:{maxMapBytes:8192}});
    try {
      rig.server.lab.mapPadBytes=200000; // ~200 KB inflated, a few hundred bytes on the wire
      expect(await rig.adapter.execute(rig.command("c-1"))).toMatchObject({accepted:false,reason:"ROBOT_UNREACHABLE"});
      expect(rig.server.gotoCount).toBe(0);
    } finally { await rig.close(); }
    expect(()=>inflateMapData(deflateSync(JSON.stringify({pad:"x".repeat(100000)})),8192)).toThrow("MAP_TOO_LARGE");
    expect(()=>inflateMapData(new Uint8Array([1,2,3]),8192)).toThrow("INVALID_MAP_DATA");
  });
  test("only provisioned private-LAN http(s) origins are accepted", () => {
    for(const bad of ["http://example.com","http://8.8.8.8","http://192.168.1.5/api","http://u:p@192.168.1.5","ftp://192.168.1.5","http://192.168.1.5/?x=1","http://127.0.0.1:8080","http://172.32.0.1","not a url"]) expect(()=>lanEndpoint(bad),bad).toThrow();
    expect(lanEndpoint("http://192.168.1.20:80")).toBe("http://192.168.1.20");
    expect(lanEndpoint("http://10.0.2.2:8080/")).toBe("http://10.0.2.2:8080");
    expect(lanEndpoint("http://robot-1.local")).toBe("http://robot-1.local");
    expect(lanEndpoint("http://127.0.0.1:8080",{allowLoopback:true})).toBe("http://127.0.0.1:8080");
    expect(()=>validateProfile(valetudoProfile("rest","http://8.8.8.8"))).toThrow("ENDPOINT_NOT_LAN");
    expect(()=>validateProfile({...valetudoProfile("mqtt","http://10.0.0.1"),mqtt:{topicPrefix:"valetudo",identifier:"#"}})).toThrow("INVALID_MQTT_TOPIC");
    expect(()=>validateProfile({...valetudoProfile("rest","http://10.0.0.1"),transport:"ws" as never})).toThrow("UNSUPPORTED_TRANSPORT");
    expect(()=>new RestTransport({endpoint:"http://evil.example",requestTimeoutMs:1,maxMapBytes:1})).toThrow("ENDPOINT_NOT_LAN");
  });
  test("the manifest stays below hardware validation and cannot dispatch outside the native executor", async () => {
    const rig = await createValetudoRig();
    try {
      const manifest=await rig.adapter.describe();
      expect(manifest).toMatchObject({adapter:"valetudo",validation:"integration_tested",units:"cm",targetKind:"valetudo",speedControl:false,zoneEnforcement:false,protocolVersion:"valetudo-rest-v2@2026.10.0"});
      expect(driverRegistry.valetudo).toMatchObject({units:"cm",speedControl:false,zones:false,targetKind:"valetudo"});
      expect(profileReason({driver:"valetudo",validation:manifest.validation})).toBe("VALIDATION_INSUFFICIENT");
      expect(rig.adapter.executor).toBeUndefined();
      const store={effects:async()=>[],claimEffect:async()=>true,completeEffect:async()=>{},snapshots:async()=>[]};
      await expect(dispatchRobotEffects(store,{organizationId:"org-a",venueId:"venue-a"},rig.adapter,rig.clock.ms)).rejects.toThrow("NATIVE_EXECUTOR_REQUIRED");
      expect(()=>new ValetudoAdapter(rig.profile,new MqttTransport(rig.server.broker.client("valetudo/EmulatedRobot/"),rig.profile))).toThrow("TRANSPORT_MISMATCH");
      expect(arrivalConfirmed({fresh:true,mapMatches:true,goalMatches:true,stationary:true,distanceM:0.41,toleranceM:0.4})).toBe(false);
    } finally { await rig.close(); }
  });
});

describe("valetudo MQTT conformance (in-process fake broker, no MQTT client library installed)", () => {
  test("retained telemetry is never evidence; commands are never retained; acceptance needs motion evidence", async () => {
    const rig = await createValetudoRig({transport:"mqtt"});
    try {
      // Only the broker's retained replay so far: nothing heard live from the robot.
      expect(await rig.adapter.execute(rig.command("c-1"))).toMatchObject({accepted:false,unknown:false,reason:"ROBOT_UNREACHABLE"});
      rig.server.telemetry({status:"idle"});
      const c2=rig.command("c-2");
      expect(await rig.adapter.execute(c2)).toEqual({accepted:false,unknown:true,reason:"AWAITING_MOTION_EVIDENCE"});
      expect(rig.server.gotoCount).toBe(1);expect(rig.server.lab.discardedRetained).toBe(0);
      expect(rig.server.lab.gotos[0]).toMatchObject({x:2500,y:1200});
      expect(rig.types()).not.toContain("accepted");
      await rig.tick(1000);rig.server.driving();await rig.tick(1000);
      expect(rig.types()).toEqual(["accepted","progress"]);
      // MQTT publishes on change/refresh: the stationary stretch needs live republishes spanning stationaryMs.
      rig.server.idleAt();await rig.tick(1000);rig.server.telemetry({});await rig.tick(1500);rig.server.telemetry({});await rig.tick(500);
      expect(rig.events.filter(e=>e.type==="completed")).toHaveLength(1);
      expect(await rig.adapter.execute(c2)).toMatchObject({accepted:true});
      expect(rig.server.gotoCount).toBe(1);
    } finally { await rig.close(); }
  });
  test("a stale retained 'idle at the goal' after reconnect does not confirm arrival", async () => {
    const server = await createValetudoServer();
    try {
      let ms=Date.parse('2026-11-01T00:00:00Z');const now=()=>ms;
      const profile=valetudoProfile("mqtt",server.url);
      const adapter=new ValetudoAdapter(profile,new MqttTransport(server.broker.client(`${server.topic}/`),profile,now),now),events:string[]=[];
      adapter.observe(e=>events.push(e.type));
      server.telemetry({status:"idle"});
      const c={schemaVersion:1 as const,commandId:"c-1",operationId:"op",organizationId:"org-a",venueId:"venue-a",robotId:"valetudo-1",missionId:"m",stopId:"s",missionRevision:1,controlEpoch:1,issuerDeviceId:"device-a",issuedAt:new Date(ms).toISOString(),expiresAt:new Date(ms+60000).toISOString(),target:{mapId:"valetudo-map",mapRevision:"r1",frame:"valetudo",x:25,y:12},limits:{trays:1,maxLoadMinor:"0"}};
      await adapter.execute(c);ms+=1000;server.driving();await adapter.poll();
      // A second subscriber (e.g. the executor after reconnect) only gets retained replays: they are marked and ignored.
      server.idleAt();
      const late=new ValetudoAdapter(profile,new MqttTransport(server.broker.client(`${server.topic}/`),profile,now),now),lateEvents:string[]=[];
      late.observe(e=>lateEvents.push(e.type));
      expect(await late.execute({...c,commandId:"c-9"})).toMatchObject({reason:"ROBOT_UNREACHABLE"});
      expect(lateEvents).toEqual([]);
    } finally { await server.close(); }
  });
  test("broker down: no send, a gap mid-trip is unknown; per-robot ACL refuses other robots' topics", async () => {
    const rig = await createValetudoRig({transport:"mqtt"});
    try {
      rig.server.telemetry({status:"idle"});
      rig.server.broker.down();
      expect(await rig.adapter.execute(rig.command("c-1"))).toMatchObject({accepted:false,reason:"ROBOT_UNREACHABLE"});
      rig.server.broker.restore();rig.server.telemetry({});
      await rig.adapter.execute(rig.command("c-2"));
      await rig.tick(1000);rig.server.driving();await rig.tick(1000);
      rig.server.broker.down();await rig.tick(1000);
      rig.server.broker.restore();rig.server.idleAt();await rig.tick(1000);await rig.tick(2500);
      expect(rig.types()).not.toContain("completed");
      expect(rig.events.at(-1)).toMatchObject({type:"unknown",payload:{reason:"TELEMETRY_GAP"}});
      const other=new MqttTransport(rig.server.broker.client(`${rig.server.topic}/`),{mqtt:{topicPrefix:"valetudo",identifier:"OtherRobot"},maxMapBytes:8192});
      expect(await other.goto(rig.command("x"),{x:1,y:1})).toMatchObject({ack:"unknown"});
      expect(rig.server.gotoCount).toBe(1);
    } finally { await rig.close(); }
  });
  test("an MQTT STOP is only delivered, never acknowledged; cancel still waits for stationary evidence", async () => {
    const rig = await createValetudoRig({transport:"mqtt"});
    try {
      rig.server.telemetry({status:"idle"});
      await rig.adapter.execute(rig.command("c-1"));
      await rig.tick(1000);rig.server.driving();await rig.tick(1000);
      expect(await rig.adapter.cancel("c-1")).toEqual({acknowledged:false,unknown:true});
      expect(rig.server.stopCount).toBe(1);
      expect(await rig.adapter.requestStop("operator")).toEqual({acknowledged:false,physicalStopConfirmed:false});
      expect(await rig.adapter.execute(rig.command("c-2",{stopId:"stop-2"}))).toMatchObject({accepted:false});
      expect(rig.server.gotoCount).toBe(1);
    } finally { await rig.close(); }
  });
  test("an MQTT device restart between polls (Homie $state lost) is a gap, never arrival", async () => {
    const rig = await createValetudoRig({transport:"mqtt"});
    try {
      rig.server.telemetry({status:"idle"});
      await rig.adapter.execute(rig.command("c-1"));
      await rig.tick(1000);rig.server.driving();await rig.tick(1000);
      rig.server.reboot();rig.server.idleAt(2500,1200);await rig.tick(1000);rig.server.telemetry({});await rig.tick(2500);
      expect(rig.types()).not.toContain("completed");
      expect(rig.events.at(-1)).toMatchObject({type:"unknown"});
    } finally { await rig.close(); }
  });
});

describe("native executor transport (typed bridge, fake native side)", () => {
  test("submits only commands, runs the shared arrival rule on native-journaled samples, and restores after a WebView reload", async () => {
    const { NativeExecutorTransport } = await import("../../apps/tablet-android/src/robot-executor-bridge");
    let ms=Date.parse('2026-11-01T00:00:00Z');const now=()=>ms;
    const samples:import("../../packages/robot-adapters/src/valetudo/map").ValetudoSample[]=[],calls:string[]=[];
    const fp=valetudoProfile("native","http://10.0.2.2:1").mapFingerprint;
    const sample=(o:object)=>samples.push({receivedAtMs:ms,reachable:true,status:"idle",mapFingerprint:fp,uptimeS:100+ms/1000,...o});
    const journal=new Map<string,{hash:string;ackAtMs:number}>();
    const bridge={
      async submit({command}:{command:import("../../packages/contracts/src/index").RobotCommand}){calls.push(`submit:${command.commandId}`);expect(Object.keys(command)).not.toContain("url");journal.set(command.commandId,{hash:"h",ackAtMs:ms});return {accepted:true,unknown:false};},
      async reconcile({commandId}:{commandId:string}):Promise<import("../../packages/robot-adapters/src/contract").NativeExecutionState>{const j=journal.get(commandId);return j?{status:"executing" as const,evidence:{transport:"native",nativeState:"executing",hash:j.hash,goal:{x:2500,y:1200},ackAtMs:j.ackAtMs,samples:samples.filter(s=>s.receivedAtMs>=j.ackAtMs) as never}}:{status:"unknown" as const,evidence:{reason:"NO_GOAL_QUERY"}};},
      async cancel(){return {acknowledged:true,unknown:false};},
      async requestStop(){return {acknowledged:true,physicalStopConfirmed:false};},
      async observations({sinceMs}:{sinceMs:number}){return {samples:samples.filter(s=>s.receivedAtMs>=sinceMs)};},
    };
    const profile=valetudoProfile("native","http://10.0.2.2:1"),rig=await createValetudoRig();
    try {
      const adapter=new ValetudoAdapter(profile,new NativeExecutorTransport(bridge),now),events:string[]=[];adapter.observe(e=>events.push(e.type));
      expect(adapter.executor).toBe("native");
      const store={effects:async()=>[],claimEffect:async()=>true,completeEffect:async()=>{},snapshots:async()=>[]};
      await expect(dispatchRobotEffects(store,{organizationId:"org-a",venueId:"venue-a"},adapter,ms)).resolves.toEqual([]);
      const c=rig.command("c-1");
      expect(await adapter.execute(c)).toMatchObject({accepted:true});
      ms+=1000;sample({status:"moving",goToTarget:{x:2500,y:1200},position:{x:2200,y:1300}});await adapter.poll();
      ms+=1000;sample({position:{x:2500,y:1200}});await adapter.poll();
      ms+=2500;sample({position:{x:2500,y:1200}});
      // WebView reload: a fresh adapter knows nothing, restores the goal from the native journal and judges the same evidence.
      const reloaded=new ValetudoAdapter(profile,new NativeExecutorTransport(bridge),now),after:string[]=[];reloaded.observe(e=>after.push(e.type));
      expect(await reloaded.reconcile("c-1")).toMatchObject({status:"executing"});
      await reloaded.poll();
      expect(after).toContain("completed");
      expect(await reloaded.reconcile("never-sent")).toMatchObject({status:"unknown",evidence:{reason:"NO_GOAL_QUERY"}});
      expect(calls).toEqual(["submit:c-1"]);
    } finally { await rig.close(); }
  });
});
