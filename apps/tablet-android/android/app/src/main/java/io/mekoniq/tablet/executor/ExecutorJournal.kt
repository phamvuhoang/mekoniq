package io.mekoniq.tablet.executor

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Durable executor journal (own SQLite file, synchronous=FULL). A command row with state `sending` is committed BEFORE any robot I/O; the
 * receipt (accepted/rejected/unknown + ack time) and every telemetry observation are committed after. A row still `sending` on open means the
 * process died between the two: Valetudo has no goal query, so it becomes `unknown` and is never resent. One executor binding per robot.
 * The binding row also carries the robot-level stop flag (like the Python executor's stop_requested): it is set by every stop, with or
 * without an open command row, and only an acknowledged STOP clears it. Schema v2 adds it (v1 → v2 migrates pending row stops onto it).
 */
class ExecutorJournal(context:Context,name:String="mekoniq-executor.db"):SQLiteOpenHelper(context,name,null,2),AutoCloseable {
  data class Stop(val state:String,val reason:String?,val attempts:Int,val retryAtMs:Long?)
  data class Row(val commandId:String,val robotId:String,val hash:String,val controlEpoch:Long,val transport:String,val goalX:Long,val goalY:Long,val state:String,val reason:String?,val ackAtMs:Long?,val stopAtMs:Long?,val stopState:String?)
  init { setWriteAheadLoggingEnabled(true) }
  override fun onConfigure(db:SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
  override fun onCreate(db:SQLiteDatabase) {
    db.execSQL("CREATE TABLE executor_binding(robot_id TEXT PRIMARY KEY,executor_id TEXT NOT NULL,control_epoch INTEGER NOT NULL)")
    addStopColumns(db)
    db.execSQL("CREATE TABLE executor_command(command_id TEXT PRIMARY KEY,robot_id TEXT NOT NULL,command_hash TEXT NOT NULL,control_epoch INTEGER NOT NULL,transport TEXT NOT NULL,goal_x INTEGER NOT NULL,goal_y INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('sending','executing','cancelling','unknown','failed','superseded')),reason TEXT,ack_at_ms INTEGER,stop_at_ms INTEGER,stop_state TEXT CHECK(stop_state IS NULL OR stop_state IN('pending','acknowledged')),command_json TEXT NOT NULL,updated_at_ms INTEGER NOT NULL)")
    db.execSQL("CREATE INDEX executor_command_robot ON executor_command(robot_id,state)")
    db.execSQL("CREATE TABLE executor_observation(id INTEGER PRIMARY KEY AUTOINCREMENT,robot_id TEXT NOT NULL,received_at_ms INTEGER NOT NULL,sample_json TEXT NOT NULL)")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int) {
    check(oldVersion==1&&newVersion==2) {"UNSUPPORTED_SCHEMA_UPGRADE"}
    addStopColumns(db)
    db.execSQL("UPDATE executor_binding SET stop_state='pending' WHERE robot_id IN(SELECT robot_id FROM executor_command WHERE stop_state='pending')")
  }
  private fun addStopColumns(db:SQLiteDatabase) {
    db.execSQL("ALTER TABLE executor_binding ADD COLUMN stop_state TEXT CHECK(stop_state IS NULL OR stop_state IN('pending','rejected','acknowledged'))")
    for(column in listOf("stop_reason TEXT","stop_attempts INTEGER NOT NULL DEFAULT 0","stop_retry_at_ms INTEGER")) db.execSQL("ALTER TABLE executor_binding ADD COLUMN $column")
  }
  private fun <T> tx(block:(SQLiteDatabase)->T):T { val db=writableDatabase;db.beginTransaction();try { val r=block(db);db.setTransactionSuccessful();return r } finally { db.endTransaction() } }
  /**
   * One active executor per robot: a second executor id for the same robot is refused, never silently replaced. The control epoch starts at
   * the provisioned one and only ever rises (a re-provisioned profile after a handoff raises it).
   */
  fun bind(robotId:String,executorId:String,provisionedEpoch:Long=0) = tx { db ->
    db.rawQuery("SELECT executor_id FROM executor_binding WHERE robot_id=?",arrayOf(robotId)).use { if(it.moveToFirst()) {
      require(it.getString(0)==executorId) {"EXECUTOR_ALREADY_BOUND"}
      db.execSQL("UPDATE executor_binding SET control_epoch=MAX(control_epoch,?) WHERE robot_id=?",arrayOf(provisionedEpoch,robotId));return@tx } }
    db.execSQL("INSERT INTO executor_binding(robot_id,executor_id,control_epoch) VALUES(?,?,?)",arrayOf(robotId,executorId,provisionedEpoch))
  }
  fun controlEpoch(robotId:String):Long = readableDatabase.rawQuery("SELECT control_epoch FROM executor_binding WHERE robot_id=?",arrayOf(robotId)).use { if(it.moveToFirst()) it.getLong(0) else error("EXECUTOR_NOT_BOUND") }
  /** Crash recovery on open: `sending` rows have no recorded outcome. */
  fun recoverUnfinished(nowMs:Long):Int = tx { db -> db.compileStatement("UPDATE executor_command SET state='unknown',reason='CRASH_BEFORE_RECEIPT',updated_at_ms=? WHERE state='sending'").apply { bindLong(1,nowMs) }.executeUpdateDelete() }
  private fun row(c:android.database.Cursor)=Row(c.getString(0),c.getString(1),c.getString(2),c.getLong(3),c.getString(4),c.getLong(5),c.getLong(6),c.getString(7),if(c.isNull(8))null else c.getString(8),if(c.isNull(9))null else c.getLong(9),if(c.isNull(10))null else c.getLong(10),if(c.isNull(11))null else c.getString(11))
  private val columns="command_id,robot_id,command_hash,control_epoch,transport,goal_x,goal_y,state,reason,ack_at_ms,stop_at_ms,stop_state"
  fun command(commandId:String):Row? = readableDatabase.rawQuery("SELECT $columns FROM executor_command WHERE command_id=?",arrayOf(commandId)).use { if(it.moveToFirst()) row(it) else null }
  fun open(robotId:String):List<Row> = readableDatabase.rawQuery("SELECT $columns FROM executor_command WHERE robot_id=? AND state IN('sending','executing','cancelling','unknown')",arrayOf(robotId)).use { c -> buildList { while(c.moveToNext()) add(row(c)) } }
  /**
   * Journal-before-I/O. The control epoch must be the persisted one or exactly one handoff ahead of it (STALE_CONTROL_EPOCH below,
   * CONTROL_EPOCH_OUT_OF_RANGE above), so one bad client value cannot fence out every later command. Refuses an unresolved `sending` row.
   * Earlier rows still open are superseded only by the caller after it proved the robot is stationary.
   */
  fun begin(command:JSONObject,hash:String,transport:String,goalX:Long,goalY:Long,nowMs:Long):Row = tx { db ->
    val robotId=command.getString("robotId");val epoch=command.getLong("controlEpoch");val current=controlEpoch(robotId)
    require(epoch>=current) {"STALE_CONTROL_EPOCH"}
    require(epoch<=current+1) {"CONTROL_EPOCH_OUT_OF_RANGE"}
    db.rawQuery("SELECT 1 FROM executor_command WHERE robot_id=? AND state='sending'",arrayOf(robotId)).use { require(!it.moveToFirst()) {"SEND_UNRESOLVED"} }
    db.execSQL("UPDATE executor_command SET state='superseded',updated_at_ms=? WHERE robot_id=? AND state IN('executing','cancelling','unknown')",arrayOf(nowMs,robotId))
    db.execSQL("UPDATE executor_binding SET control_epoch=? WHERE robot_id=?",arrayOf(epoch,robotId))
    db.execSQL("INSERT INTO executor_command(command_id,robot_id,command_hash,control_epoch,transport,goal_x,goal_y,state,command_json,updated_at_ms) VALUES(?,?,?,?,?,?,?,'sending',?,?)",arrayOf(command.getString("commandId"),robotId,hash,epoch,transport,goalX,goalY,command.toString(),nowMs))
    command(command.getString("commandId"))!!
  }
  fun receipt(commandId:String,state:String,reason:String?,ackAtMs:Long?,nowMs:Long) = tx { db -> db.execSQL("UPDATE executor_command SET state=?,reason=?,ack_at_ms=COALESCE(?,ack_at_ms),updated_at_ms=? WHERE command_id=?",arrayOf(state,reason,ackAtMs,nowMs,commandId)) }
  /**
   * Stop intent is journaled (stop_state 'pending') before the STOP goes out; only an acknowledged STOP clears it, so the service resends
   * until then (STOP is safe to resend, a goto never is). `commandId` scopes a cancel to that command; without it the stop is robot-wide
   * (operator STOP / lease loss), because a robot has one physical motion whichever row started it.
   */
  fun stopping(robotId:String,state:String,reason:String,nowMs:Long,commandId:String?=null) = tx { db ->
    db.execSQL("UPDATE executor_command SET state=?,reason=?,stop_at_ms=?,stop_state='pending',updated_at_ms=? WHERE robot_id=? AND state IN('executing','cancelling','unknown') AND (? IS NULL OR command_id=?)",arrayOf(state,reason,nowMs,nowMs,robotId,commandId,commandId))
    // Robot-level: always set, even with no open row. An unacknowledged (pending/rejected) stop keeps its attempts and backoff, so a
    // repeated request cannot turn a rejected STOP into a STOP per call.
    db.execSQL("UPDATE executor_binding SET stop_state='pending',stop_reason=?,stop_attempts=0,stop_retry_at_ms=NULL WHERE robot_id=? AND (stop_state IS NULL OR stop_state='acknowledged')",arrayOf(reason,robotId))
  }
  fun stop(robotId:String):Stop? = readableDatabase.rawQuery("SELECT stop_state,stop_reason,stop_attempts,stop_retry_at_ms FROM executor_binding WHERE robot_id=?",arrayOf(robotId)).use {
    if(it.moveToFirst()&&!it.isNull(0)) Stop(it.getString(0),if(it.isNull(1))null else it.getString(1),it.getInt(2),if(it.isNull(3))null else it.getLong(3)) else null }
  /** A STOP is due while pending (unanswered: every tick), or once a rejected STOP's backoff has elapsed. */
  fun stopDue(robotId:String,nowMs:Long):Boolean = stop(robotId)?.let { it.state=="pending"||(it.state=="rejected"&&(it.retryAtMs ?: 0)<=nowMs) } ?: false
  fun stopAcknowledged(robotId:String,nowMs:Long) = tx { db ->
    db.execSQL("UPDATE executor_command SET stop_state='acknowledged',updated_at_ms=? WHERE robot_id=? AND stop_state='pending'",arrayOf(nowMs,robotId))
    db.execSQL("UPDATE executor_binding SET stop_state='acknowledged',stop_attempts=0,stop_retry_at_ms=NULL WHERE robot_id=? AND stop_state IS NOT NULL",arrayOf(robotId))
  }
  /** The robot answered STOP with 400: still unacknowledged, retried with exponential backoff (base × 2^attempts, capped at maxMs). */
  fun stopRejected(robotId:String,nowMs:Long,baseMs:Long,maxMs:Long) = tx { db ->
    db.execSQL("UPDATE executor_binding SET stop_state='rejected',stop_retry_at_ms=?+MIN(?*(1<<MIN(stop_attempts,16)),?),stop_attempts=stop_attempts+1 WHERE robot_id=? AND stop_state IN('pending','rejected')",arrayOf(nowMs,baseMs,maxMs,robotId))
  }
  fun observe(robotId:String,sample:JSONObject) = tx { db ->
    db.execSQL("INSERT INTO executor_observation(robot_id,received_at_ms,sample_json) VALUES(?,?,?)",arrayOf(robotId,sample.getLong("receivedAtMs"),sample.toString()))
    db.execSQL("DELETE FROM executor_observation WHERE robot_id=? AND id NOT IN(SELECT id FROM executor_observation WHERE robot_id=? ORDER BY id DESC LIMIT 500)",arrayOf(robotId,robotId))
  }
  fun observations(robotId:String,sinceMs:Long):JSONArray = readableDatabase.rawQuery("SELECT sample_json FROM executor_observation WHERE robot_id=? AND received_at_ms>=? ORDER BY id",arrayOf(robotId,sinceMs.toString())).use { c -> JSONArray().apply { while(c.moveToNext()) put(JSONObject(c.getString(0))) } }
  fun latest(robotId:String):JSONObject? = readableDatabase.rawQuery("SELECT sample_json FROM executor_observation WHERE robot_id=? ORDER BY id DESC LIMIT 1",arrayOf(robotId)).use { if(it.moveToFirst()) JSONObject(it.getString(0)) else null }
}
