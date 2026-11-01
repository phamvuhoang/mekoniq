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
 */
class ExecutorJournal(context:Context,name:String="mekoniq-executor.db"):SQLiteOpenHelper(context,name,null,1),AutoCloseable {
  data class Row(val commandId:String,val robotId:String,val hash:String,val controlEpoch:Long,val transport:String,val goalX:Long,val goalY:Long,val state:String,val reason:String?,val ackAtMs:Long?,val stopAtMs:Long?)
  init { setWriteAheadLoggingEnabled(true) }
  override fun onConfigure(db:SQLiteDatabase) { db.execSQL("PRAGMA synchronous=FULL") }
  override fun onCreate(db:SQLiteDatabase) {
    db.execSQL("CREATE TABLE executor_binding(robot_id TEXT PRIMARY KEY,executor_id TEXT NOT NULL,control_epoch INTEGER NOT NULL)")
    db.execSQL("CREATE TABLE executor_command(command_id TEXT PRIMARY KEY,robot_id TEXT NOT NULL,command_hash TEXT NOT NULL,control_epoch INTEGER NOT NULL,transport TEXT NOT NULL,goal_x INTEGER NOT NULL,goal_y INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('sending','executing','cancelling','unknown','failed','superseded')),reason TEXT,ack_at_ms INTEGER,stop_at_ms INTEGER,command_json TEXT NOT NULL,updated_at_ms INTEGER NOT NULL)")
    db.execSQL("CREATE INDEX executor_command_robot ON executor_command(robot_id,state)")
    db.execSQL("CREATE TABLE executor_observation(id INTEGER PRIMARY KEY AUTOINCREMENT,robot_id TEXT NOT NULL,received_at_ms INTEGER NOT NULL,sample_json TEXT NOT NULL)")
  }
  override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int) { error("UNSUPPORTED_SCHEMA_UPGRADE") }
  private fun <T> tx(block:(SQLiteDatabase)->T):T { val db=writableDatabase;db.beginTransaction();try { val r=block(db);db.setTransactionSuccessful();return r } finally { db.endTransaction() } }
  /** One active executor per robot: a second executor id for the same robot is refused, never silently replaced. */
  fun bind(robotId:String,executorId:String) = tx { db ->
    db.rawQuery("SELECT executor_id FROM executor_binding WHERE robot_id=?",arrayOf(robotId)).use { if(it.moveToFirst()) { require(it.getString(0)==executorId) {"EXECUTOR_ALREADY_BOUND"};return@tx } }
    db.execSQL("INSERT INTO executor_binding(robot_id,executor_id,control_epoch) VALUES(?,?,0)",arrayOf(robotId,executorId))
  }
  fun controlEpoch(robotId:String):Long = readableDatabase.rawQuery("SELECT control_epoch FROM executor_binding WHERE robot_id=?",arrayOf(robotId)).use { if(it.moveToFirst()) it.getLong(0) else error("EXECUTOR_NOT_BOUND") }
  /** Crash recovery on open: `sending` rows have no recorded outcome. */
  fun recoverUnfinished(nowMs:Long):Int = tx { db -> db.compileStatement("UPDATE executor_command SET state='unknown',reason='CRASH_BEFORE_RECEIPT',updated_at_ms=? WHERE state='sending'").apply { bindLong(1,nowMs) }.executeUpdateDelete() }
  private fun row(c:android.database.Cursor)=Row(c.getString(0),c.getString(1),c.getString(2),c.getLong(3),c.getString(4),c.getLong(5),c.getLong(6),c.getString(7),if(c.isNull(8))null else c.getString(8),if(c.isNull(9))null else c.getLong(9),if(c.isNull(10))null else c.getLong(10))
  private val columns="command_id,robot_id,command_hash,control_epoch,transport,goal_x,goal_y,state,reason,ack_at_ms,stop_at_ms"
  fun command(commandId:String):Row? = readableDatabase.rawQuery("SELECT $columns FROM executor_command WHERE command_id=?",arrayOf(commandId)).use { if(it.moveToFirst()) row(it) else null }
  fun open(robotId:String):List<Row> = readableDatabase.rawQuery("SELECT $columns FROM executor_command WHERE robot_id=? AND state IN('sending','executing','cancelling','unknown')",arrayOf(robotId)).use { c -> buildList { while(c.moveToNext()) add(row(c)) } }
  /**
   * Journal-before-I/O. Rejects a control epoch older than the persisted one (and persists a newer one), and an existing `sending` row
   * (an unresolved send). Earlier rows still open are superseded only by the caller after it proved the robot is stationary.
   */
  fun begin(command:JSONObject,hash:String,transport:String,goalX:Long,goalY:Long,nowMs:Long):Row = tx { db ->
    val robotId=command.getString("robotId");val epoch=command.getLong("controlEpoch")
    require(epoch>=controlEpoch(robotId)) {"STALE_CONTROL_EPOCH"}
    db.rawQuery("SELECT 1 FROM executor_command WHERE robot_id=? AND state='sending'",arrayOf(robotId)).use { require(!it.moveToFirst()) {"SEND_UNRESOLVED"} }
    db.execSQL("UPDATE executor_command SET state='superseded',updated_at_ms=? WHERE robot_id=? AND state IN('executing','cancelling','unknown')",arrayOf(nowMs,robotId))
    db.execSQL("UPDATE executor_binding SET control_epoch=? WHERE robot_id=?",arrayOf(epoch,robotId))
    db.execSQL("INSERT INTO executor_command(command_id,robot_id,command_hash,control_epoch,transport,goal_x,goal_y,state,command_json,updated_at_ms) VALUES(?,?,?,?,?,?,?,'sending',?,?)",arrayOf(command.getString("commandId"),robotId,hash,epoch,transport,goalX,goalY,command.toString(),nowMs))
    command(command.getString("commandId"))!!
  }
  fun receipt(commandId:String,state:String,reason:String?,ackAtMs:Long?,nowMs:Long) = tx { db -> db.execSQL("UPDATE executor_command SET state=?,reason=?,ack_at_ms=COALESCE(?,ack_at_ms),updated_at_ms=? WHERE command_id=?",arrayOf(state,reason,ackAtMs,nowMs,commandId)) }
  /** Stop intent is journaled before the stop request goes out. */
  fun stopping(robotId:String,state:String,reason:String,nowMs:Long) = tx { db -> db.execSQL("UPDATE executor_command SET state=?,reason=?,stop_at_ms=?,updated_at_ms=? WHERE robot_id=? AND state IN('executing','cancelling','unknown')",arrayOf(state,reason,nowMs,nowMs,robotId)) }
  fun observe(robotId:String,sample:JSONObject) = tx { db ->
    db.execSQL("INSERT INTO executor_observation(robot_id,received_at_ms,sample_json) VALUES(?,?,?)",arrayOf(robotId,sample.getLong("receivedAtMs"),sample.toString()))
    db.execSQL("DELETE FROM executor_observation WHERE robot_id=? AND id NOT IN(SELECT id FROM executor_observation WHERE robot_id=? ORDER BY id DESC LIMIT 500)",arrayOf(robotId,robotId))
  }
  fun observations(robotId:String,sinceMs:Long):JSONArray = readableDatabase.rawQuery("SELECT sample_json FROM executor_observation WHERE robot_id=? AND received_at_ms>=? ORDER BY id",arrayOf(robotId,sinceMs.toString())).use { c -> JSONArray().apply { while(c.moveToNext()) put(JSONObject(c.getString(0))) } }
  fun latest(robotId:String):JSONObject? = readableDatabase.rawQuery("SELECT sample_json FROM executor_observation WHERE robot_id=? ORDER BY id DESC LIMIT 1",arrayOf(robotId)).use { if(it.moveToFirst()) JSONObject(it.getString(0)) else null }
}
