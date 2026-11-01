package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import io.mekoniq.tablet.executor.ExecutorJournal
import io.mekoniq.tablet.executor.ExecutorProfile
import io.mekoniq.tablet.executor.NativeRobotTransport
import io.mekoniq.tablet.executor.ValetudoExecutor
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant

/**
 * Native executor against the host Valetudo protocol emulator (tests/support/valetudo-rig.ts, 10.0.2.2). Protocol evidence only: no robot,
 * no firmware. Host: `VALETUDO_EMULATOR_PORT=18765 pnpm exec tsx tests/support/valetudo-rig.ts`, then pass valetudoEndpoint/valetudoFingerprint.
 */
class ValetudoExecutorRecoveryTest {
  private val context=InstrumentationRegistry.getInstrumentation().targetContext
  private val args=InstrumentationRegistry.getArguments()
  private val endpoint=args.getString("valetudoEndpoint") ?: "http://10.0.2.2:18765"
  private val fingerprint=args.getString("valetudoFingerprint") ?: error("VALETUDO_FINGERPRINT_REQUIRED")
  private var now=Instant.parse("2026-11-01T00:00:00Z").toEpochMilli()
  private val db="valetudo-executor-test.db"
  private fun lab(path:String,body:JSONObject=JSONObject()):JSONObject {
    val c=(URI("$endpoint/__lab/$path").toURL().openConnection() as HttpURLConnection).apply { requestMethod=if(path=="counts")"GET" else "POST";connectTimeout=3000;readTimeout=3000;if(requestMethod=="POST"){doOutput=true;setRequestProperty("Content-Type","application/json")} }
    try { if(c.requestMethod=="POST")c.outputStream.use { it.write(body.toString().toByteArray()) };return JSONObject(c.inputStream.use { it.readBytes().toString(Charsets.UTF_8) }) } finally { c.disconnect() }
  }
  private fun gotos()=lab("counts").getJSONArray("gotos").length()
  private fun stops()=lab("counts").getInt("stops")
  private fun profile(onLeaseLoss:String="stop",epoch:Int=1)=ExecutorProfile.parse(JSONObject().put("robotId","valetudo-1").put("executorId","tablet-a").put("controlEpoch",epoch).put("transport","rest").put("endpoint",endpoint).put("mapId","valetudo-map").put("mapRevision","r1").put("mapFingerprint",fingerprint).put("frame","valetudo").put("leaseMs",5000).put("onLeaseLoss",onLeaseLoss))
  private fun executor(onLeaseLoss:String="stop",epoch:Int=1)=ExecutorJournal(context,db).let { ValetudoExecutor(it,NativeRobotTransport(endpoint),profile(onLeaseLoss,epoch)) { now } to it }
  private fun command(id:String,epoch:Int=1,limits:JSONObject=JSONObject().put("trays",1).put("maxLoadMinor","5000"))=JSONObject().put("schemaVersion",1).put("commandId",id).put("operationId","op-$id").put("organizationId","org-a").put("venueId","venue-a").put("robotId","valetudo-1").put("missionId","mission-1").put("stopId","stop-1").put("missionRevision",1).put("controlEpoch",epoch).put("issuerDeviceId","device-a")
    .put("issuedAt",Instant.ofEpochMilli(now).toString()).put("expiresAt",Instant.ofEpochMilli(now+60000).toString()).put("target",JSONObject().put("waypointId","table-1").put("mapId","valetudo-map").put("mapRevision","r1").put("frame","valetudo").put("x",25).put("y",12).put("yaw",0)).put("limits",limits)
  @Before fun reset() { context.deleteDatabase(db);lab("reset") }

  @Test fun crashBetweenJournalAndReceiptBecomesUnknownAndNeverSendsGotoTwice() {
    val first=command("c-1")
    ExecutorJournal(context,db).use { j -> j.bind("valetudo-1","tablet-a",1);j.begin(first,JournalDatabase.hash(first),"rest",2500,1200,now) } // process dies here, before I/O
    val (reopened,journal)=executor()
    journal.use {
      val state=reopened.reconcile("c-1")
      assertEquals("unknown",state.getString("status"));assertEquals("CRASH_BEFORE_RECEIPT",state.getJSONObject("evidence").getString("reason"))
      val again=reopened.submit(first)
      assertFalse(again.getBoolean("accepted"));assertTrue(again.getBoolean("unknown"))
      assertEquals(0,gotos())
      val second=command("c-2")
      assertTrue(reopened.submit(second).getBoolean("accepted"));assertEquals(1,gotos())
      assertEquals(JSONObject().put("x",2500).put("y",1200).toString(),lab("counts").getJSONArray("gotos").getJSONObject(0).let { JSONObject().put("x",it.getInt("x")).put("y",it.getInt("y")) }.toString())
    }
    val (afterCrash,journal2)=executor() // crash after the receipt: the same command is answered from the journal
    journal2.use { assertTrue(afterCrash.submit(command("c-2")).getBoolean("accepted"));assertEquals(1,gotos()) }
  }

  @Test fun staleControlEpochIsRefusedAcrossReopenWithoutIoAndABadEpochCannotLockOutLaterCommands() {
    executor(epoch=2).let { (e,j) -> j.use {
      val jump=e.submit(command("c-bad",epoch=999))
      assertEquals("CONTROL_EPOCH_OUT_OF_RANGE",jump.getString("reason")) // never persisted
      assertTrue(e.submit(command("c-3",epoch=3)).getBoolean("accepted")) // provisioned 2, one handoff ahead
    } }
    executor(epoch=2).let { (e,j) -> j.use {
      val stale=e.submit(command("c-old",epoch=2))
      assertFalse(stale.getBoolean("accepted"));assertFalse(stale.getBoolean("unknown"));assertEquals("STALE_CONTROL_EPOCH",stale.getString("reason"))
      assertTrue(e.submit(command("c-4",epoch=3)).getBoolean("accepted")) // the real epoch still works after the bad value
    } }
    assertEquals(2,gotos())
  }

  @Test fun crashAfterSendWithNoUiIsStoppedOnLeaseLossAndAFailedStopIsRetried() {
    val first=command("c-1")
    ExecutorJournal(context,db).use { j -> j.bind("valetudo-1","tablet-a",1);j.begin(first,JournalDatabase.hash(first),"rest",2500,1200,now) }
    assertEquals("accepted",NativeRobotTransport(endpoint).goto(2500,1200)) // the goto went out; the process died before the receipt
    lab("telemetry",JSONObject().put("status","moving").put("flag","target").put("goToTarget",JSONObject().put("x",2500).put("y",1200)))
    lab("stop-failures",JSONObject().put("count",1))
    val (service,journal)=executor() // START_STICKY restart: no UI, so nothing renews the lease
    journal.use {
      assertEquals("unknown",journal.command("c-1")!!.state);assertEquals("CRASH_BEFORE_RECEIPT",journal.command("c-1")!!.reason)
      service.tick();assertEquals(0,stops()) // lease still fresh after the restart
      now+=6000;service.tick()
      assertEquals(1,stops());assertEquals("pending",journal.command("c-1")!!.stopState) // STOP answered 500: journaled as not acknowledged
      now+=1000;service.tick()
      assertEquals(2,stops());assertEquals("acknowledged",journal.command("c-1")!!.stopState) // resent until acknowledged
      now+=1000;service.tick();assertEquals(2,stops())
      assertEquals("LEASE_LOST_STOPPED",journal.command("c-1")!!.reason)
      assertEquals(1,gotos()) // STOP is resent, a goto never is
    }
  }

  @Test fun suspendedUiNeverAcknowledgesArrivalAndLeaseLossStopsTheRobot() {
    executor("continue").let { (e,j) -> j.use {
      assertTrue(e.submit(command("c-1")).getBoolean("accepted"))
      // UI suspended: no plugin calls; only the service loop runs.
      now+=1000;lab("telemetry",JSONObject().put("status","moving").put("flag","target").put("goToTarget",JSONObject().put("x",2500).put("y",1200)));e.tick()
      lab("telemetry",JSONObject().put("status","idle").put("flag","none").put("goToTarget",JSONObject.NULL).put("x",2500).put("y",1200))
      repeat(4) { now+=2000;e.tick() }
      val state=e.reconcile("c-1")
      assertEquals("executing",state.getString("status")) // arrival evidence journaled, never self-acknowledged as completed
      assertTrue(state.getJSONObject("evidence").getJSONArray("samples").length()>=5)
      assertEquals(0,stops())
    } }
    context.deleteDatabase(db);lab("reset")
    executor("stop").let { (e,j) -> j.use {
      assertTrue(e.submit(command("c-2")).getBoolean("accepted"))
      now+=1000;lab("telemetry",JSONObject().put("status","moving").put("flag","target").put("goToTarget",JSONObject().put("x",2500).put("y",1200)));e.tick()
      assertEquals(0,stops())
      now+=6000;e.tick() // lease (5 s) lapsed mid-trip: journal, then STOP; the goal is unknown, not completed
      assertEquals(1,stops())
      val state=e.reconcile("c-2")
      assertEquals("unknown",state.getString("status"));assertEquals("LEASE_LOST_STOPPED",state.getJSONObject("evidence").getString("reason"))
      now+=6000;e.tick();assertEquals(1,stops()) // one stop, not a stop per tick
      val retarget=e.submit(command("c-3"))
      assertEquals("PREVIOUS_GOAL_ACTIVE",retarget.getString("reason")) // still moving: STOP then retarget waits for evidence
      lab("telemetry",JSONObject().put("status","idle").put("flag","none").put("goToTarget",JSONObject.NULL))
      assertTrue(e.submit(command("c-3")).getBoolean("accepted"));assertEquals(2,gotos())
    } }
  }

  @Test fun unsupportedSpeedForeignEndpointsAndSecondExecutorAreRefused() {
    executor().let { (e,j) -> j.use {
      val speed=e.submit(command("s",limits=JSONObject().put("trays",1).put("maxLoadMinor","5000").put("speedLimitMps",0.4)))
      assertEquals("SPEED_UNSUPPORTED",speed.getString("reason"));assertEquals(0,gotos())
      val error=runCatching { j.bind("valetudo-1","tablet-b") }.exceptionOrNull()
      assertEquals("EXECUTOR_ALREADY_BOUND",error?.message)
      assertTrue(e.submit(command("c-1")).getBoolean("accepted"))
      val other=e.cancel("not-this-one") // cancel is scoped to the named command: no STOP, c-1 untouched
      assertFalse(other.getBoolean("acknowledged"));assertEquals(0,stops());assertEquals("executing",j.command("c-1")!!.state)
      lab("telemetry",JSONObject().put("status","error").put("error","Wheel stuck"))
      assertEquals("ROBOT_ERROR",e.submit(command("c-2")).getString("reason")) // an erroring robot gets no goto
      assertEquals(1,gotos())
    } }
    for(bad in listOf("http://8.8.8.8","http://example.com","http://10.0.2.2:1/api","http://u:p@10.0.2.2","file:///etc/hosts"))
      assertNotNull(bad,runCatching { NativeRobotTransport.lanOrigin(bad) }.exceptionOrNull())
    assertThrows(IllegalArgumentException::class.java) { ValetudoExecutor(ExecutorJournal(context,db),NativeRobotTransport(endpoint),profile().copy(transport="mqtt")) { now } }
  }

  @Test fun nativeMapFingerprintMatchesTheTypeScriptRule() {
    val sample=NativeRobotTransport(endpoint).sample(now)
    assertTrue(sample.toString(),sample.getBoolean("reachable"))
    assertEquals(fingerprint,sample.getString("mapFingerprint"))
    assertEquals("idle",sample.getString("status"))
  }
}
