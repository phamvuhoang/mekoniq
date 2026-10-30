package io.mekoniq.tablet.identity

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

private data class AuthorityState(val epoch:Int,val revision:Int,val owner:String,val ownerEpoch:String,val fenced:Boolean)

@CapacitorPlugin(name = "Identity")
class IdentityPlugin : Plugin() {
  private val keys by lazy { DeviceKeys(context) }
  @PluginMethod fun cloudRequest(call:PluginCall) {
    bridge.execute {try{call.resolve(JSObject(CloudDeviceClient(context).request(call.getString("method") ?: error("METHOD_REQUIRED"),call.getString("path") ?: error("PATH_REQUIRED"),call.getObject("body")).toString()))}catch(e:Exception){call.reject(e.message,"CLOUD_UNAVAILABLE",e)}}
  }
  @PluginMethod fun enroll(call:PluginCall) {
    bridge.execute {try {call.resolve(JSObject(EnrollmentClient(context).enroll(call.getString("accessToken") ?: error("MANAGER_SESSION_REQUIRED")).toString()))}catch(e:Exception){call.reject(e.message,"ENROLLMENT_FAILED",e)}}
  }
  @PluginMethod fun refreshProvisioning(call:PluginCall) {
    bridge.execute {try {call.resolve(JSObject(EnrollmentClient(context).provision(call.getString("accessToken") ?: error("MANAGER_SESSION_REQUIRED")).toString()))}catch(e:Exception){call.reject(e.message,"PROVISION_FAILED",e)}}
  }
  @PluginMethod fun publicJwk(call: PluginCall) { call.resolve(JSObject().put("jwk", JSObject(keys.publicJwk())).put("hardwareBacked", keys.isHardwareBacked()).put("certificate", DeviceKeys.base64(keys.certificateBytes())).put("certificateFingerprint",io.mekoniq.tablet.lan.PairingRegistry.fingerprint(keys.certificateBytes()))) }
  @PluginMethod fun installGrant(call: PluginCall) {
    try {
      val grant=call.getObject("grant") ?: error("INVALID_GRANT")
      val payload=grant.getJSONObject("payload")
      val issuer=(context.getSystemService(android.content.Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager).applicationRestrictions.getString("enrollmentIssuerJwk") ?: error("ISSUER_NOT_PROVISIONED")
      require(DeviceKeys.verify(issuer,io.mekoniq.tablet.storage.JournalDatabase.canonical(payload),DeviceKeys.decode(grant.getString("signature") ?: error("INVALID_SIGNATURE")))) { "INVALID_GRANT_SIGNATURE" }
      require(payload.getString("deviceEpoch")==keys.deviceEpoch()) { "WRONG_DEVICE_EPOCH" }
      require(context.getSharedPreferences("device-identity",0).edit().putString("offlineGrant",grant.toString()).commit())
      call.resolve(JSObject().put("installed",true))
    } catch(e:Exception) { call.reject(e.message,"INVALID_GRANT",e) }
  }
  @PluginMethod fun session(call: PluginCall) {
    try {
      val config=(context.getSystemService(android.content.Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager).applicationRestrictions
      val issuer=config.getString("enrollmentIssuerJwk") ?: error("ENROLLMENT_REQUIRED")
      val grant=org.json.JSONObject(context.getSharedPreferences("device-identity",0).getString("offlineGrant",null) ?: error("OFFLINE_GRANT_REQUIRED"))
      val payload=grant.getJSONObject("payload")
      require(DeviceKeys.verify(issuer,io.mekoniq.tablet.storage.JournalDatabase.canonical(payload),DeviceKeys.decode(grant.getString("signature") ?: error("INVALID_SIGNATURE")))) { "INVALID_GRANT_SIGNATURE" }
      require(payload.getString("deviceEpoch")==keys.deviceEpoch() && payload.getString("deviceId")==config.getString("deviceId")) { "WRONG_DEVICE" }
      require(payload.getString("organizationId")==config.getString("organizationId") && payload.getString("venueId")==config.getString("venueId")) { "SCOPE_MISMATCH" }
      val now=System.currentTimeMillis()
      val expires=java.time.Instant.parse(payload.getString("expiresAt")).toEpochMilli()
      val issued=java.time.Instant.parse(payload.getString("issuedAt")).toEpochMilli()
      val authority=io.mekoniq.tablet.storage.JournalDatabase(context).use {db->db.readableDatabase.rawQuery("SELECT coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,fenced FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(payload.getString("organizationId"),payload.getString("venueId"))).use {cursor->require(cursor.moveToFirst()){"AUTHORITY_NOT_PROVISIONED"};AuthorityState(cursor.getInt(0),cursor.getInt(1),cursor.getString(2),cursor.getString(3),cursor.getInt(4)!=0)}}
      val privileged=issued<=now+30000 && expires>now && expires-issued<=86400000 && payload.getInt("coordinatorEpoch")==authority.epoch
      val permissions=payload.getJSONArray("permissions")
      val role=if((0 until permissions.length()).any { permissions.getString(it) in setOf("*","configuration.publish","continuity.resolve") })"manager" else if((0 until permissions.length()).any { permissions.getString(it).startsWith("kitchen") })"chef" else "cashier"
      val pendingOperations=org.json.JSONArray()
      io.mekoniq.tablet.storage.JournalDatabase(context).use { db ->
        val pending=db.pendingOutbox()
        for(index in 0 until pending.length()) {
          val item=pending.getJSONObject(index)
          if(item.getString("kind")=="command.intent") {
            val command=item.getJSONObject("payload")
            pendingOperations.put(org.json.JSONObject().put("operationId",command.getString("operationId")).put("type",command.getString("type")).put("tableId",command.getJSONObject("payload").optString("tableId")))
          }
        }
      }
      call.resolve(JSObject(payload.toString()).put("cloudIssuerPublicJwk",org.json.JSONObject(issuer)).put("pendingOperations",pendingOperations).put("actorId",payload.getString("actorRef")).put("role",role).put("permissions",permissions)
        .put("coordinatorEpoch",authority.epoch).put("policyRevision",authority.revision).put("mode",if(privileged)"coordinated" else "capture-only")
        .put("level","unknown").put("pendingCount",io.mekoniq.tablet.storage.JournalDatabase(context).use { it.pendingOutbox().length() })
        .put("lastSyncAt",io.mekoniq.tablet.storage.JournalDatabase(context).use {db->db.readableDatabase.rawQuery("SELECT last_sync_at FROM sync_status WHERE id=1",null).use {if(it.moveToFirst())it.getString(0) else org.json.JSONObject.NULL}}).put("ownerEndpoint",config.getString("ownerEndpoint","")).put("isCoordinator",config.getBoolean("coordinatorEnabled",false)&&!authority.fenced&&authority.owner==config.getString("deviceId")&&authority.ownerEpoch==keys.deviceEpoch()))
    } catch(e:Exception) { call.reject(e.message,"ENROLLMENT_REQUIRED",e) }
  }
  @PluginMethod fun deviceEpoch(call: PluginCall) { call.resolve(JSObject().put("deviceEpoch", keys.deviceEpoch())) }
}
