package io.mekoniq.tablet.identity

import android.content.Context
import android.content.RestrictionsManager
import org.json.JSONObject
import javax.net.ssl.HttpsURLConnection
import io.mekoniq.tablet.storage.JournalDatabase

/** Device proof signing is bound to a small HTTPS API allowlist, never arbitrary bytes. */
class CloudDeviceClient(private val context:Context) {
  fun request(method:String,path:String,body:JSONObject?,request:NetworkRequest=NetworkRequest()):JSONObject {
    request.checkActive()
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val venue=config.getString("venueId") ?: error("ENROLLMENT_REQUIRED")
    require(Regex("[A-Za-z0-9_-]{1,128}").matches(venue))
    val allowed=setOf("/v1/sync/handshake","/v1/sync/push","/v1/sync/pull","/v1/sync/ack","/v1/venues/$venue/relay/pull","/v1/venues/$venue/relay/receipt","/v1/venues/$venue/configuration/pull","/v1/venues/$venue/configuration/apply")
    require(method=="POST" && path in allowed) {"CLOUD_PATH_FORBIDDEN"}
    val base=config.getString("cloudBaseUrl") ?: error("CLOUD_NOT_PROVISIONED")
    val origin=java.net.URI(base);require(origin.scheme=="https" && origin.host!=null && origin.rawUserInfo==null && origin.rawQuery==null && origin.rawFragment==null && (origin.rawPath.isNullOrEmpty() || origin.rawPath=="/"))
    val bytes=(body?.toString() ?: "null").toByteArray();require(bytes.size<=1048576){"PAYLOAD_TOO_LARGE"}
    val keys=DeviceKeys(context)
    val hash=java.security.MessageDigest.getInstance("SHA-256").digest(org.erdtman.jcs.JsonCanonicalizer(body?.toString() ?: "null").encodedUTF8).joinToString("") {"%02x".format(it)}
    val proof=JSONObject().put("organizationId",config.getString("organizationId") ?: error("ENROLLMENT_REQUIRED")).put("venueId",venue).put("deviceId",config.getString("deviceId") ?: error("ENROLLMENT_REQUIRED")).put("deviceEpoch",keys.deviceEpoch()).put("method",method).put("path",path).put("bodyHash",hash).put("nonce",java.util.UUID.randomUUID().toString()).put("issuedAt",java.time.Instant.now().toString())
    val envelope=JSONObject().put("payload",proof).put("signature",DeviceKeys.base64(keys.sign(JournalDatabase.canonical(proof))))
    val connection=java.net.URL(base.trimEnd('/')+path).openConnection() as HttpsURLConnection
    connection.instanceFollowRedirects=false;connection.requestMethod=method;connection.doOutput=true;connection.connectTimeout=3000;connection.readTimeout=10000
    connection.setRequestProperty("Content-Type","application/json");connection.setRequestProperty("X-Mekoniq-Device-Proof",DeviceKeys.base64(envelope.toString().toByteArray()))
    connection.sslSocketFactory=request.socketFactory(connection.sslSocketFactory)
    request.attach(connection)
    return try {
      connection.outputStream.use {it.write(bytes)}
      val status=connection.responseCode
      val stream=if(status<400)connection.inputStream else connection.errorStream
      val result=stream?.use {input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(out.size()<=1048576){val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)};out.toByteArray()} ?: "{}".toByteArray()
      require(result.size<=1048576){"RESPONSE_TOO_LARGE"}
      request.checkActive()
      val parsed=JournalDatabase.parseJsonStrict(result.toString(Charsets.UTF_8))
      if(status in 200..299 && path=="/v1/sync/push")JournalDatabase(context).use {it.recordVerifiedCloudAck(parsed)}
      if(status in 200..299 && path=="/v1/sync/ack") {
        val ack=JSONObject(parsed.toString()).put("schemaVersion",1).put("organizationId",config.getString("organizationId")).put("venueId",venue).put("deviceId",config.getString("deviceId")).put("deviceEpoch",keys.deviceEpoch()).put("entries",org.json.JSONArray())
        JournalDatabase(context).use {it.recordVerifiedCloudAck(ack)}
      }
      JSONObject().put("status",status).put("body",parsed)
    } finally {request.release(connection);connection.disconnect()}
  }
}
