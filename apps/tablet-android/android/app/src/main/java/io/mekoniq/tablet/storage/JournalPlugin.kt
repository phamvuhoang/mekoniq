package io.mekoniq.tablet.storage

import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import android.database.sqlite.SQLiteFullException
import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.annotation.ActivityCallback
import io.mekoniq.tablet.export.JournalExport

@CapacitorPlugin(name = "Journal")
class JournalPlugin : Plugin() {
  private val db by lazy { JournalDatabase(context) }
  private fun execute(call: PluginCall, operation: () -> JSObject) {
    bridge.execute {
      try { call.resolve(operation()) }
      catch(e: Exception) { val code = when(e) { is SQLiteFullException -> "STORAGE_FULL"; is VersionConflict -> "VERSION_CONFLICT"; else -> e.message ?: "INVALID_BATCH" }; call.reject(code,code,e) }
    }
  }
  @PluginMethod fun exportArchive(call:PluginCall) {
    try {io.mekoniq.tablet.identity.OfflineIdentity.requireManager(context)}catch(e:Exception){call.reject(e.message,"FORBIDDEN",e);return}
    if((call.getString("password") ?: "").length<12){call.reject("ARCHIVE_PASSWORD_TOO_SHORT");return}
    val intent=Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"mekoniq-journal-${java.time.LocalDate.now()}.encrypted.json")
    startActivityForResult(call,intent,"archiveCreated")
  }
  @ActivityCallback private fun archiveCreated(call:PluginCall?,result:ActivityResult) {
    if(call==null)return
    val uri=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK||uri==null){call.reject("EXPORT_CANCELLED");return}
    execute(call){val password=(call.getString("password") ?: error("PASSWORD_REQUIRED")).toCharArray();try{JSObject(JournalExport.write(context,uri,db,password).toString())}finally{password.fill('\u0000')}}
  }
  @PluginMethod fun inspectArchive(call:PluginCall) = openArchive(call,false)
  @PluginMethod fun restoreArchive(call:PluginCall) = openArchive(call,true)
  private fun openArchive(call:PluginCall,restore:Boolean) {
    try {io.mekoniq.tablet.identity.OfflineIdentity.requireManager(context)}catch(e:Exception){call.reject(e.message,"FORBIDDEN",e);return}
    if((call.getString("password") ?: "").length<12){call.reject("ARCHIVE_PASSWORD_TOO_SHORT");return}
    call.data.put("restore",restore)
    startActivityForResult(call,Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json"),"archiveSelected")
  }
  @ActivityCallback private fun archiveSelected(call:PluginCall?,result:ActivityResult) {
    if(call==null)return
    val uri=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK||uri==null){call.reject("IMPORT_CANCELLED");return}
    execute(call){val password=(call.getString("password") ?: error("PASSWORD_REQUIRED")).toCharArray();try{val inner=JournalExport.read(context,uri,password);JSObject(if(call.getBoolean("restore",false)==true)JournalExport.restoreInactive(context,inner).toString() else inner.getJSONObject("manifest").toString())}finally{password.fill('\u0000')}}
  }
  @PluginMethod fun checkpoint(call:PluginCall) = execute(call) {JSObject(db.checkpoint().toString())}
  @PluginMethod fun fenceCurrentOwner(call:PluginCall) = execute(call) {
    io.mekoniq.tablet.identity.OfflineIdentity.requireManager(context)
    JSObject(db.fenceCurrentOwner(call.getString("handoffId") ?: error("HANDOFF_REQUIRED")).toString())
  }
  @PluginMethod fun commitBatch(call: PluginCall) = execute(call) { JSObject(db.commit(call.getObject("batch") ?: error("INVALID_BATCH")).toString()) }
  @PluginMethod fun readSnapshot(call: PluginCall) = execute(call) { JSObject(db.readSnapshot(call.getObject("ref") ?: error("INVALID_REF")).toString()) }
  @PluginMethod fun pendingOutbox(call: PluginCall) = execute(call) { JSObject().put("entries",JSArray(db.pendingOutbox().toString())) }
  @PluginMethod fun ack(call: PluginCall) = execute(call) { error("CLOUD_TRANSPORT_REQUIRED") }
  @PluginMethod fun snapshots(call: PluginCall) = execute(call) { JSObject().put("snapshots",JSArray(db.snapshots(call.getObject("scope") ?: error("INVALID_SCOPE")).toString())) }
  @PluginMethod fun events(call: PluginCall) = execute(call) { JSObject().put("events",JSArray(db.events(call.getObject("scope") ?: error("INVALID_SCOPE"),call.getString("type")).toString())) }
  @PluginMethod fun journal(call: PluginCall) = execute(call) { JSObject().put("entries",JSArray(db.journal(call.getObject("scope") ?: error("INVALID_SCOPE")).toString())) }
  @PluginMethod fun receipt(call: PluginCall) = execute(call) { JSObject().put("result",db.receipt(call.getObject("scope") ?: error("INVALID_SCOPE"),call.getString("operationId") ?: error("INVALID_OPERATION_ID"),call.getString("payloadHash") ?: error("INVALID_HASH"),call.getObject("command")) ?: org.json.JSONObject.NULL) }
  @PluginMethod fun acknowledge(call: PluginCall) = execute(call) { val ack=call.getObject("ack") ?: error("INVALID_ACK");db.verifyCloudAck(ack);db.acknowledge(ack);JSObject().put("committed",true) }
  @PluginMethod fun claimEffect(call: PluginCall) = execute(call) { JSObject().put("claimed",db.claimEffect(call.getObject("scope") ?: error("INVALID_SCOPE"),call.getString("id") ?: error("INVALID_ID"))) }
  @PluginMethod fun completeEffect(call: PluginCall) = execute(call) { db.completeEffect(call.getObject("scope") ?: error("INVALID_SCOPE"),call.getString("id") ?: error("INVALID_ID"),call.getString("status") ?: error("INVALID_STATUS"));JSObject().put("committed",true) }
  @PluginMethod fun effects(call: PluginCall) = execute(call) { JSObject().put("effects",JSArray(db.effects(call.getObject("scope") ?: error("INVALID_SCOPE"),call.getString("type")).toString())) }
  @PluginMethod fun receiveCloudEntries(call:PluginCall) = execute(call) { JSObject(db.receiveCloudEntries(call.getArray("entries") ?: error("INVALID_BATCH")).toString()) }
  @PluginMethod fun journalCount(call: PluginCall) = execute(call) { JSObject().put("count",db.journalCount()) }
  @PluginMethod fun provision(call: PluginCall) = execute(call) { db.provisionSigned(call.getObject("grant") ?: error("INVALID_GRANT"),call.getString("signature") ?: error("INVALID_SIGNATURE")); JSObject().put("provisioned",true) }
  override fun handleOnDestroy() { db.close(); super.handleOnDestroy() }
}
