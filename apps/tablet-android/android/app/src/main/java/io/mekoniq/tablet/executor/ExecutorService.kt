package io.mekoniq.tablet.executor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.RestrictionsManager
import android.os.IBinder
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import java.time.Instant

/** Provisioned by MDM app restrictions (`valetudoProfile`, JSON); never supplied by the WebView. Mirrors ValetudoProfile in TS. */
data class ExecutorProfile(val robotId:String,val executorId:String,val controlEpoch:Long,val transport:String,val endpoint:String,val mapId:String,val mapRevision:String,val mapFingerprint:String,val frame:String,
  val leaseMs:Long,val pollMs:Long,val onLeaseLoss:String,val requestTimeoutMs:Int,val maxMapBytes:Int) {
  companion object {
    fun parse(p:JSONObject)=ExecutorProfile(p.getString("robotId"),p.getString("executorId"),p.getLong("controlEpoch"),p.getString("transport"),p.getString("endpoint"),p.getString("mapId"),p.getString("mapRevision"),p.getString("mapFingerprint"),p.getString("frame"),
      p.optLong("leaseMs",5000),p.optLong("pollMs",1000),p.optString("onLeaseLoss","stop"),p.optInt("requestTimeoutMs",2000),p.optInt("maxMapBytes",1 shl 20)).also {
        require(it.onLeaseLoss in setOf("stop","continue")&&it.leaseMs>0&&it.pollMs>0&&it.controlEpoch>=0) {"INVALID_PROFILE"}
      }
    fun provisioned(context:Context):ExecutorProfile? = (context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions.getString("valetudoProfile")?.let { parse(JSONObject(it)) }
  }
}

/**
 * The single executor for one robot. Journal before I/O, never a second goto for a command id, stale control epochs refused, heartbeat
 * (lease) and stop policy enforced here so they hold while the UI is suspended. It never reports `completed`: arrival is judged from the
 * journaled evidence by the shared rule (packages/robot-adapters/src/valetudo/completion.ts) once a live UI reconciles.
 */
class ValetudoExecutor(private val journal:ExecutorJournal,private val transport:NativeRobotTransport,private val profile:ExecutorProfile,private val clock:()->Long=System::currentTimeMillis) {
  @Volatile private var leaseMs=clock()
  init {
    require(profile.transport=="rest") {"TRANSPORT_UNSUPPORTED"}
    journal.bind(profile.robotId,profile.executorId,profile.controlEpoch)
    journal.recoverUnfinished(clock())
  }
  private fun lease() { leaseMs=clock() }
  private fun refuse(reason:String)=JSONObject().put("accepted",false).put("unknown",false).put("reason",reason)
  private fun acceptance(r:ExecutorJournal.Row):JSONObject = when(r.state) {
    "executing","cancelling"->JSONObject().put("accepted",true).put("unknown",false)
    "failed"->refuse(r.reason ?: "GOTO_REJECTED")
    else->JSONObject().put("accepted",false).put("unknown",true).put("reason",r.reason ?: r.state)
  }
  @Synchronized fun submit(command:JSONObject):JSONObject {
    lease();val now=clock()
    val id=command.optString("commandId")
    if(command.optInt("schemaVersion")!=1||id.isBlank()||id.length>128) return refuse("INVALID_COMMAND")
    val hash=JournalDatabase.hash(command)
    journal.command(id)?.let { old -> require(old.hash==hash) {"IDEMPOTENCY_CONFLICT"};return acceptance(old) } // same command: what the journal knows, no resend
    if(command.optString("robotId")!=profile.robotId) return refuse("ROBOT_MISMATCH")
    val epoch=command.optLong("controlEpoch",-1);val current=journal.controlEpoch(profile.robotId)
    if(epoch<current) return refuse("STALE_CONTROL_EPOCH")
    if(epoch>current+1) return refuse("CONTROL_EPOCH_OUT_OF_RANGE") // at most one handoff ahead of the provisioned/persisted epoch
    val expires=runCatching { Instant.parse(command.getString("expiresAt")).toEpochMilli() }.getOrNull() ?: return refuse("INVALID_COMMAND")
    if(expires<=now) return refuse("EXPIRED_COMMAND")
    val limits=command.optJSONObject("limits") ?: return refuse("INVALID_COMMAND")
    if(limits.has("speedLimitMps")) return refuse("SPEED_UNSUPPORTED") // no Valetudo speed control; a limit is refused, never ignored
    val target=command.optJSONObject("target") ?: return refuse("INVALID_TARGET")
    if(target.optString("mapId")!=profile.mapId||target.optString("mapRevision")!=profile.mapRevision) return refuse("MAP_MISMATCH")
    if(target.optString("frame")!=profile.frame) return refuse("FRAME_MISMATCH")
    val x=target.optDouble("x");val y=target.optDouble("y")
    if(!x.isFinite()||!y.isFinite()) return refuse("INVALID_TARGET")
    val caps=runCatching { transport.capabilities() }.getOrNull() ?: return refuse("ROBOT_UNREACHABLE")
    if(!caps.containsAll(listOf("GoToLocationCapability","BasicControlCapability"))) return refuse("CAPABILITY_UNSUPPORTED")
    val pre=transport.sample(clock());journal.observe(profile.robotId,pre)
    if(!pre.optBoolean("reachable")) return refuse("ROBOT_UNREACHABLE")
    if(pre.optString("mapFingerprint")!=profile.mapFingerprint) return refuse("MAP_MISMATCH")
    if(pre.optString("status")=="error") return refuse("ROBOT_ERROR")
    // One goal at a time: an earlier open goal is superseded only when a fresh sample shows the robot is not driving one (STOP then retarget).
    if(journal.open(profile.robotId).isNotEmpty()&&(pre.optString("status")!="idle"||pre.has("goToTarget"))) return refuse("PREVIOUS_GOAL_ACTIVE")
    val row=try { journal.begin(command,hash,profile.transport,Math.round(x*100),Math.round(y*100),clock()) } catch(e:IllegalArgumentException) { return refuse(e.message ?: "REFUSED") }
    val ack=transport.goto(row.goalX,row.goalY);val at=clock()
    when(ack) { "accepted"->journal.receipt(id,"executing",null,at,at);"rejected"->journal.receipt(id,"failed","GOTO_REJECTED",null,at);else->journal.receipt(id,"unknown","NO_ACK",null,at) }
    return acceptance(journal.command(id)!!)
  }
  /** Never `completed` and never a resend: journal state plus the observations since the ACK (or stop), for the shared arrival rule. */
  @Synchronized fun reconcile(commandId:String):JSONObject {
    lease()
    val r=journal.command(commandId) ?: return JSONObject().put("status","unknown").put("evidence",JSONObject().put("reason","NO_GOAL_QUERY").put("transport","native"))
    val status=when(r.state) { "cancelling"->"executing";"superseded"->"unknown";else->r.state }
    val since=r.ackAtMs ?: r.stopAtMs
    val evidence=JSONObject().put("transport","native").put("commandId",r.commandId).put("hash",r.hash).put("controlEpoch",r.controlEpoch).put("goal",JSONObject().put("x",r.goalX).put("y",r.goalY)).put("nativeState",r.state)
      .put("reason",r.reason ?: JSONObject.NULL).put("ackAtMs",r.ackAtMs ?: JSONObject.NULL).put("stopAtMs",r.stopAtMs ?: JSONObject.NULL).put("stopState",r.stopState ?: JSONObject.NULL).put("samples",if(since==null) org.json.JSONArray() else journal.observations(r.robotId,since))
    return JSONObject().put("status",status).put("evidence",evidence)
  }
  @Synchronized fun observations(sinceMs:Long)=run { lease();journal.observations(profile.robotId,sinceMs) }
  @Synchronized fun cancel(commandId:String):JSONObject {
    lease()
    val r=journal.command(commandId)
    if(r==null||r.state !in setOf("executing","cancelling","unknown")) return JSONObject().put("acknowledged",false).put("unknown",r==null)
    journal.stopping(profile.robotId,"cancelling","CANCEL_REQUESTED",clock(),commandId) // only the named command is cancelled
    val ack=sendStop()
    return JSONObject().put("acknowledged",ack=="acknowledged").put("unknown",ack!="acknowledged"&&ack!="rejected")
  }
  /** A stop request is acknowledged or not; it is never a physical-stop proof. */
  @Synchronized fun requestStop(reason:String):JSONObject {
    require(reason.isNotBlank()) {"STOP_REASON_REQUIRED"}
    lease();journal.stopping(profile.robotId,"unknown","STOP_REQUESTED",clock()) // robot-wide: one robot, one physical motion
    return JSONObject().put("acknowledged",sendStop()=="acknowledged").put("physicalStopConfirmed",false)
  }
  /** Sends STOP and journals an acknowledgement; anything else leaves stop_state 'pending' and tick() resends it. */
  private fun sendStop():String { val ack=transport.stop();if(ack=="acknowledged") journal.stopAcknowledged(profile.robotId,clock());return ack }
  /**
   * Service loop body: journal one observation. If the UI lease lapsed and any open goal (executing, cancelling or unknown — e.g. NO_ACK or
   * CRASH_BEFORE_RECEIPT after a restart with no UI, exactly the goals that may be driving) was never stopped, journal the stop. Then resend
   * STOP every tick while a journaled stop is not acknowledged. An already-ended goal the native side still holds open costs one harmless STOP.
   */
  @Synchronized fun tick() {
    val now=clock();journal.observe(profile.robotId,transport.sample(now))
    if(profile.onLeaseLoss=="stop"&&now-leaseMs>profile.leaseMs&&journal.open(profile.robotId).any { it.stopState==null })
      journal.stopping(profile.robotId,"unknown","LEASE_LOST_STOPPED",now)
    if(journal.open(profile.robotId).any { it.stopState=="pending" }) sendStop()
  }
}

/** Foreground service: keeps the executor's observation journal and lease/stop policy running while the WebView is suspended. */
class ExecutorService:Service() {
  @Volatile private var running=false
  override fun onBind(intent:Intent?):IBinder?=null
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
    val executor=runCatching { executor(this) }.getOrNull() ?: run { stopSelf();return START_NOT_STICKY }
    val notifications=getSystemService(NotificationManager::class.java)
    notifications.createNotificationChannel(NotificationChannel("executor","MEKONIQ robot executor",NotificationManager.IMPORTANCE_LOW))
    startForeground(42,Notification.Builder(this,"executor").setContentTitle("MEKONIQ robot executor").setContentText("Robot commands are journaled on this tablet").setSmallIcon(android.R.drawable.stat_notify_sync).build())
    if(!running) { running=true;Thread({ while(running) { runCatching { executor.tick() };Thread.sleep(profile!!.pollMs) } },"valetudo-executor").start() }
    return START_STICKY
  }
  override fun onDestroy() { running=false;super.onDestroy() }
  companion object {
    @Volatile private var instance:ValetudoExecutor?=null
    @Volatile private var profile:ExecutorProfile?=null
    /** One executor per process, for the one provisioned robot; the journal binding refuses a second executor id for that robot. */
    @Synchronized fun executor(context:Context):ValetudoExecutor = instance ?: run {
      val p=ExecutorProfile.provisioned(context) ?: error("EXECUTOR_NOT_PROVISIONED")
      ValetudoExecutor(ExecutorJournal(context.applicationContext),NativeRobotTransport(p.endpoint,p.requestTimeoutMs,p.maxMapBytes),p).also { instance=it;profile=p }
    }
  }
}
