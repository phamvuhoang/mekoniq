package io.mekoniq.tablet.identity

import android.content.Context
import android.content.RestrictionsManager
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import javax.net.ssl.HttpsURLConnection

/** HTTPS enrollment uses an operator session and an issuer pinned in the managed profile. */
class EnrollmentClient(private val context:Context) {
  private val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
  private fun post(path:String,body:JSONObject,token:String):JSONObject {
    val base=config.getString("cloudBaseUrl") ?: error("CLOUD_NOT_PROVISIONED")
    require(base.startsWith("https://")) { "HTTPS_REQUIRED" }
    val connection=java.net.URL(base.trimEnd('/')+path).openConnection() as HttpsURLConnection
    connection.instanceFollowRedirects=false;connection.requestMethod="POST";connection.doOutput=true;connection.connectTimeout=5000;connection.readTimeout=10000
    connection.setRequestProperty("Authorization","Bearer $token");connection.setRequestProperty("Content-Type","application/json")
    return try {
      connection.outputStream.use {it.write(body.toString().toByteArray())}
      require(connection.responseCode in 200..299) { "ENROLLMENT_HTTP_${connection.responseCode}" }
      val bytes=connection.inputStream.use { input ->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(4096);while(out.size()<=4194304){val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)};out.toByteArray() }
      require(bytes.size<=4194304);JSONObject(bytes.toString(Charsets.UTF_8))
    } finally {connection.disconnect()}
  }
  fun enroll(accessToken:String):JSONObject {
    val org=config.getString("organizationId") ?: error("SCOPE_NOT_PROVISIONED")
    val venue=config.getString("venueId") ?: error("SCOPE_NOT_PROVISIONED")
    val device=config.getString("deviceId") ?: error("DEVICE_NOT_PROVISIONED")
    require(Regex("[A-Za-z0-9_-]{1,128}").matches(venue) && Regex("[A-Za-z0-9_-]{1,128}").matches(device))
    val challenge=post("/v1/venues/$venue/devices/challenge",JSONObject(),accessToken)
    val keys=DeviceKeys(context)
    val payload=JSONObject().put("organizationId",org).put("venueId",venue).put("nonce",challenge.getString("nonce")).put("deviceId",device).put("deviceEpoch",keys.deviceEpoch()).put("publicJwk",JSONObject(keys.publicJwk())).put("certificateFingerprint",io.mekoniq.tablet.lan.PairingRegistry.fingerprint(keys.certificateBytes()))
    val enrolled=post("/v1/devices/enroll",JSONObject().put("payload",payload).put("signature",DeviceKeys.base64(keys.sign(JournalDatabase.canonical(payload)))),accessToken)
    require(enrolled.getString("deviceEpoch")==keys.deviceEpoch()) { "ENROLLMENT_EPOCH_MISMATCH" }
    return provision(accessToken)
  }
  fun provision(accessToken:String):JSONObject {
    val venue=config.getString("venueId") ?: error("SCOPE_NOT_PROVISIONED")
    val device=config.getString("deviceId") ?: error("DEVICE_NOT_PROVISIONED")
    require(Regex("[A-Za-z0-9_-]{1,128}").matches(venue) && Regex("[A-Za-z0-9_-]{1,128}").matches(device))
    val response=post("/v1/venues/$venue/devices/$device/provision",JSONObject(),accessToken)
    val authority=response.getJSONObject("authority")
    JournalDatabase(context).use {it.provisionSigned(authority.getJSONObject("grant"),authority.getString("signature"))}
    val offline=response.getJSONObject("offlineGrant");val issuer=config.getString("enrollmentIssuerJwk") ?: error("ISSUER_NOT_PROVISIONED")
    require(DeviceKeys.verify(issuer,JournalDatabase.canonical(offline.getJSONObject("payload")),DeviceKeys.decode(offline.getString("signature")))) { "INVALID_OFFLINE_GRANT" }
    require(offline.getJSONObject("payload").getString("deviceEpoch")==DeviceKeys(context).deviceEpoch()) { "WRONG_DEVICE_EPOCH" }
    require(context.getSharedPreferences("device-identity",0).edit().putString("offlineGrant",offline.toString()).putString("pairingGrant",response.getJSONObject("pairingGrant").toString()).commit())
    return JSONObject().put("deviceId",device).put("deviceEpoch",DeviceKeys(context).deviceEpoch()).put("provisioned",true)
  }
}
