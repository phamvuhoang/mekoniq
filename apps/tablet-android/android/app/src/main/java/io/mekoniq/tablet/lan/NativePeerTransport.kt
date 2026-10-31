package io.mekoniq.tablet.lan

import android.content.Context
import android.content.RestrictionsManager
import io.mekoniq.tablet.identity.DeviceKeys
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import java.security.cert.X509Certificate
import java.util.UUID

class NativePeerTransport(private val context:Context) {
  fun send(command:JSONObject):JSONObject {
    JournalDatabase(context).use { db ->
      val local=db.recordIntent(command)
      if(local.getString("status") in setOf("accepted","rejected"))return local
      val result=request("/v1/commands","POST",command)
      db.recordVenueReceipt(command,result)
      return if(result.getString("status")=="unknown")result.put("status","pending").put("ack","local") else result
    }
  }
  fun pair(offer:JSONObject):JSONObject {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    require(offer.getString("organizationId")==config.getString("organizationId") && offer.getString("venueId")==config.getString("venueId") && offer.getString("endpoint")==config.getString("ownerEndpoint") && offer.getString("fingerprint")==config.getString("ownerFingerprint")) {"PAIRING_OWNER_MISMATCH"}
    require(java.time.Instant.parse(offer.getString("expiresAt")).isAfter(java.time.Instant.now())) {"PAIRING_OFFER_EXPIRED"}
    val saved=JSONObject(context.getSharedPreferences("device-identity",0).getString("pairingGrant",null) ?: error("PAIRING_GRANT_REQUIRED"))
    val keys=DeviceKeys(context)
    val proof=JSONObject().put("offer",offer).put("grant",saved.getJSONObject("grant")).put("grantSignature",saved.getString("signature")).put("nonceSignature",DeviceKeys.base64(keys.sign(JournalDatabase.canonical(offer)))).put("certificateFingerprint",PairingRegistry.fingerprint(keys.certificateBytes()))
    return request("/v1/pair","POST",proof)
  }
  fun flushSettlementObservations():Int {
    var accepted=0
    JournalDatabase(context).use {db ->
      val entries=db.pendingVenueObservations()
      for(entry in entries) {
        if(entry.getString("kind")!="observation" || entry.getJSONObject("payload").optString("operationType") !in setOf("SettlementGrant.Use","SettlementGrant.Return","Continuity.CaptureTicket","Continuity.RecordPaymentObservation"))continue
        val result=request("/v1/settlement-observations","POST",entry)
        if(result.optString("status")!="accepted")break
        db.recordVenueObservationReceipt(entry,result)
        accepted++
      }
    }
    return accepted
  }
  fun exchangeCheckpoints() {JournalDatabase(context).use {db->val response=request("/v1/checkpoints","POST",db.checkpoint());db.installCheckpoint(response.getJSONObject("checkpoint"))}}
  fun pull():JSONObject = request("/v1/snapshots","GET",null)
  private fun request(path:String,method:String,command:JSONObject?):JSONObject {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val endpoint=config.getString("ownerEndpoint") ?: error("OWNER_NOT_PROVISIONED")
    val fingerprint=config.getString("ownerFingerprint") ?: error("OWNER_NOT_PROVISIONED")
    require(endpoint.startsWith("https://"))
    val bytes=command?.toString()?.toByteArray() ?: byteArrayOf()
    require(bytes.size<=262144)
    val hash=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val proof=JSONObject().put("deviceId",config.getString("deviceId") ?: error("IDENTITY_NOT_PROVISIONED"))
      .put("method",method).put("path",path).put("bodyHash",hash).put("timestampMs",System.currentTimeMillis()).put("nonce",UUID.randomUUID().toString())
    val keys=DeviceKeys(context)
    val trust=object:X509TrustManager {
      override fun getAcceptedIssuers():Array<X509Certificate> = emptyArray()
      override fun checkClientTrusted(chain:Array<X509Certificate>,authType:String) { error("UNSUPPORTED") }
      override fun checkServerTrusted(chain:Array<X509Certificate>,authType:String) { require(chain.isNotEmpty() && PairingRegistry.fingerprint(chain[0].encoded)==fingerprint) { "OWNER_CERTIFICATE_MISMATCH" };chain[0].checkValidity() }
    }
    val ssl=SSLContext.getInstance("TLS").apply { init(null,arrayOf(trust),java.security.SecureRandom()) }
    val connection=(java.net.URL(endpoint.trimEnd('/')+path).openConnection() as HttpsURLConnection).apply {
      sslSocketFactory=ssl.socketFactory
      hostnameVerifier=javax.net.ssl.HostnameVerifier { _,session -> PairingRegistry.fingerprint(session.peerCertificates[0].encoded)==fingerprint }
      connectTimeout=2000;readTimeout=6000;requestMethod=method;doOutput=method=="POST";if(method=="POST")setFixedLengthStreamingMode(bytes.size)
      setRequestProperty("Content-Type","application/json")
      setRequestProperty("X-Device-Proof",DeviceKeys.base64(JournalDatabase.canonical(proof)))
      setRequestProperty("X-Device-Signature",DeviceKeys.base64(keys.sign(JournalDatabase.canonical(proof))))
    }
    return try {
      if(method=="POST")connection.outputStream.use { it.write(bytes) }
      val stream=if(connection.responseCode<400)connection.inputStream else connection.errorStream
      val text=stream.use { input ->
        val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
        while(out.size()<=1048576) { val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n) }
        out.toByteArray().toString(Charsets.UTF_8)
      }
      require(text.toByteArray().size<=1048576)
      JSONObject(text).also { if(command!=null&&path in setOf("/v1/commands","/v1/settlement-observations"))require(it.getString("operationId")==command.getString("operationId")) }
    } catch(error:Exception) { if(command!=null&&path in setOf("/v1/commands","/v1/settlement-observations"))RuntimeQueue.unknown(command,"OWNER_UNREACHABLE") else throw error }
    finally { connection.disconnect() }
  }
}
