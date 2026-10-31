package io.mekoniq.tablet.lan

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.JSArray
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import io.mekoniq.tablet.storage.JournalDatabase

@CapacitorPlugin(name="Lan")
class LanPlugin:Plugin() {
  @PluginMethod fun exchangeCheckpoints(call:PluginCall) {bridge.execute {try{NativePeerTransport(context).exchangeCheckpoints();call.resolve()}catch(e:Exception){call.reject(e.message,"CHECKPOINT_PENDING",e)}}}
  @PluginMethod fun flushSettlementObservations(call:PluginCall) {
    bridge.execute {try{call.resolve(JSObject().put("accepted",NativePeerTransport(context).flushSettlementObservations()))}catch(e:Exception){call.reject(e.message,"SETTLEMENT_SYNC_PENDING",e)}}
  }
  @PluginMethod fun pullSnapshots(call:PluginCall) {
    bridge.execute {
      try { JournalDatabase(context).use { db -> call.resolve(JSObject().put("snapshots",JSArray(db.applyRemoteSnapshots(NativePeerTransport(context).pull()).toString()))) } }
      catch(e:Exception) { call.reject(e.message,"OWNER_UNAVAILABLE",e) }
    }
  }
  @PluginMethod fun send(call:PluginCall) {
    bridge.execute {
      try { call.resolve(JSObject(NativePeerTransport(context).send(call.getObject("command") ?: error("INVALID_COMMAND")).toString())) }
      catch(e:Exception) { call.reject(e.message,"OWNER_UNAVAILABLE",e) }
    }
  }
  @PluginMethod fun start(call:PluginCall) {
    try { context.startForegroundService(Intent(context,LanService::class.java));call.resolve(JSObject().put("started",true)) }
    catch(e:Exception) { call.reject("LAN_START_FAILED","LAN_START_FAILED",e) }
  }
  @PluginMethod fun heartbeat(call:PluginCall) { RuntimeQueue.heartbeat(call.getBoolean("storeWritable",false) ?: false);call.resolve(JSObject().put("ready",RuntimeQueue.ready())) }
  @PluginMethod fun poll(call:PluginCall) { call.resolve(JSObject().put("requests",JSArray(RuntimeQueue.poll().toString()))) }
  @PluginMethod fun complete(call:PluginCall) {
    try {
      val requestId=call.getString("id") ?: error("INVALID_REQUEST_ID")
      val request=RuntimeQueue.request(requestId)
      val result=call.getObject("result") ?: error("INVALID_RESULT")
      require(result.getString("operationId")==request.command.getString("operationId"))
      if(result.getString("status")=="accepted") {
        JournalDatabase(context).use { db ->
          val command=request.command
          db.readableDatabase.rawQuery("SELECT result_json FROM operation_receipt WHERE organization_id=? AND venue_id=? AND operation_id=? AND payload_hash=?",arrayOf(command.getString("organizationId"),command.getString("venueId"),command.getString("operationId"),command.getString("payloadHash"))).use {
            require(it.moveToFirst()) { "RECEIPT_NOT_COMMITTED" }
            val persisted=org.json.JSONObject(it.getString(0))
            require(persisted.getString("status")=="accepted") { "RECEIPT_REJECTED" }
          }
        }
      }
      RuntimeQueue.complete(requestId,result);call.resolve()
    } catch(e:Exception) { call.reject(e.message,"INVALID_COMPLETION",e) }
  }
  @PluginMethod fun stop(call:PluginCall) { context.stopService(Intent(context,LanService::class.java));RuntimeQueue.suspendRuntime();call.resolve() }
  @PluginMethod fun pairWithCoordinator(call:PluginCall) {
    bridge.execute {try{io.mekoniq.tablet.identity.OfflineIdentity.requireManager(context);call.resolve(JSObject(NativePeerTransport(context).pair(call.getObject("offer") ?: error("INVALID_OFFER")).toString()))}catch(e:Exception){call.reject(e.message,"PAIRING_FAILED",e)}}
  }
  @PluginMethod fun pairingOffer(call:PluginCall) {
    try {io.mekoniq.tablet.identity.OfflineIdentity.requireManager(context); PairingRegistry(context).use { call.resolve(JSObject(it.offer(call.getString("endpoint") ?: error("ENDPOINT_REQUIRED"),call.getString("organizationId") ?: error("SCOPE_REQUIRED"),call.getString("venueId") ?: error("SCOPE_REQUIRED")).toString())) } }
    catch(e:Exception) { call.reject(e.message,"PAIRING_FAILED",e) }
  }
  @PluginMethod fun pair(call:PluginCall) {
    try { PairingRegistry(context).use { it.accept(call.getObject("offer") ?: error("INVALID_OFFER"),call.getObject("grant") ?: error("INVALID_GRANT"),call.getString("grantSignature") ?: error("INVALID_SIGNATURE"),call.getString("nonceSignature") ?: error("INVALID_SIGNATURE"),call.getString("certificateFingerprint") ?: error("INVALID_CERTIFICATE")) };call.resolve() }
    catch(e:Exception) { call.reject(e.message,"PAIRING_FAILED",e) }
  }
}
