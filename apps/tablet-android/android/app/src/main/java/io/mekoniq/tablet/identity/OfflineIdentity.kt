package io.mekoniq.tablet.identity

import android.content.Context
import android.content.RestrictionsManager
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject

object OfflineIdentity {
  fun requireManager(context:Context) {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val issuer=config.getString("enrollmentIssuerJwk") ?: error("ENROLLMENT_REQUIRED")
    val envelope=JSONObject(context.getSharedPreferences("device-identity",0).getString("offlineGrant",null) ?: error("OFFLINE_GRANT_REQUIRED"))
    val grant=envelope.getJSONObject("payload")
    require(DeviceKeys.verify(issuer,JournalDatabase.canonical(grant),DeviceKeys.decode(envelope.getString("signature")))) {"INVALID_OFFLINE_GRANT"}
    require(grant.getString("deviceId")==config.getString("deviceId") && grant.getString("deviceEpoch")==DeviceKeys(context).deviceEpoch() && grant.getString("organizationId")==config.getString("organizationId") && grant.getString("venueId")==config.getString("venueId")) {"GRANT_SCOPE_MISMATCH"}
    require(java.time.Instant.parse(grant.getString("expiresAt")).isAfter(java.time.Instant.now())) {"GRANT_EXPIRED"}
    val permissions=grant.getJSONArray("permissions");require((0 until permissions.length()).any {permissions.getString(it) in setOf("*","continuity.resolve")}) {"MANAGER_REQUIRED"}
  }
}
