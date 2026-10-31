package io.mekoniq.tablet.lan

import android.app.Service
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.Context
import android.content.RestrictionsManager
import android.os.IBinder
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import io.mekoniq.tablet.identity.DeviceKeys
import org.json.JSONObject
import java.io.IOException
import java.security.SecureRandom
import javax.net.ssl.SSLContext
import javax.net.ssl.KeyManager

class LanService : Service() {
  private var listener:Listener?=null
  private var discovery:Discovery?=null
  override fun onBind(intent:Intent?):IBinder?=null
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
    val manager=getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
    val config=manager.applicationRestrictions
    if(!config.getBoolean("coordinatorEnabled",false)) { stopSelf();return START_NOT_STICKY }
    val org=config.getString("organizationId");val venue=config.getString("venueId")
    if(org.isNullOrBlank() || venue.isNullOrBlank()) { stopSelf();return START_NOT_STICKY }
    val notifications=getSystemService(NotificationManager::class.java)
    notifications.createNotificationChannel(NotificationChannel("coordinator","MEKONIQ coordinator",NotificationManager.IMPORTANCE_LOW))
    startForeground(41,Notification.Builder(this,"coordinator").setContentTitle("MEKONIQ LAN coordinator").setContentText("Keep this app in the foreground during service").setSmallIcon(android.R.drawable.stat_notify_sync).build())
    if(listener==null) {
      val port=config.getInt("coordinatorPort",18443)
      val ssl=SSLContext.getInstance("TLS").apply { init(DeviceKeys(this@LanService).keyManagers(),null,SecureRandom()) }
      listener=Listener(this,port,org,venue).also {
        it.makeSecure(ssl.serverSocketFactory,ssl.supportedSSLParameters.protocols.filter { protocol -> protocol in setOf("TLSv1.3","TLSv1.2") }.toTypedArray());it.start(5000,false)
      }
      discovery=Discovery(this).also { runCatching { it.advertise(port) } }
      RuntimeQueue.serviceUp=true
    }
    return START_NOT_STICKY
  }
  override fun onDestroy() { RuntimeQueue.serviceUp=false;RuntimeQueue.suspendRuntime();listener?.stop();listener=null;discovery?.close();super.onDestroy() }

  private class Listener(private val context:Context,port:Int,private val organizationId:String,private val venueId:String):NanoWSD(port) {
    private val pairing=PairingRegistry(context)
    override fun serveHttp(session:IHTTPSession):Response {
      return try {
        val body=readBody(session)
        if(session.method==Method.POST && session.uri=="/v1/pair") {
          val proof=io.mekoniq.tablet.storage.JournalDatabase.parseJsonStrict(body)
          require(proof.getJSONObject("offer").getString("organizationId")==organizationId && proof.getJSONObject("offer").getString("venueId")==venueId)
          pairing.accept(proof.getJSONObject("offer"),proof.getJSONObject("grant"),proof.getString("grantSignature"),proof.getString("nonceSignature"),proof.getString("certificateFingerprint"))
          return json(Response.Status.OK,JSONObject().put("paired",true))
        }
        val peer=authenticate(session,body)
        when {
          session.method==Method.POST && session.uri=="/v1/checkpoints" -> {
            val checkpoint=io.mekoniq.tablet.storage.JournalDatabase.parseJsonStrict(body)
            val grant=pairing.actorGrant(peer,true)
            require(checkpoint.getString("deviceId")==peer&&checkpoint.getString("deviceEpoch")==grant.getString("deviceEpoch")) {"CHECKPOINT_SOURCE_MISMATCH"}
            val own=io.mekoniq.tablet.storage.JournalDatabase(context).use {it.installCheckpoint(checkpoint);it.checkpoint()}
            json(Response.Status.OK,JSONObject().put("checkpoint",own))
          }
          session.method==Method.GET && session.uri=="/v1/health" -> json(if(RuntimeQueue.ready()) Response.Status.OK else Response.Status.SERVICE_UNAVAILABLE,JSONObject().put("ready",RuntimeQueue.ready()).put("mode",if(RuntimeQueue.ready())"coordinated" else "isolated"))
          session.method==Method.POST && session.uri=="/v1/settlement-observations" -> {
            val entry=io.mekoniq.tablet.storage.JournalDatabase.parseJsonStrict(body)
            val grant=pairing.actorGrant(peer,true)
            require(entry.getString("organizationId")==organizationId && entry.getString("venueId")==venueId && entry.getString("deviceId")==peer && entry.getString("deviceEpoch")==grant.getString("deviceEpoch")) {"SETTLEMENT_SOURCE_MISMATCH"}
            val scope=JSONObject().put("organizationId",organizationId).put("venueId",venueId)
            val all=io.mekoniq.tablet.storage.JournalDatabase(context).use {it.snapshots(scope)}
            val authority=(0 until all.length()).map {all.getJSONObject(it)}.first {it.getJSONObject("ref").getString("kind")=="__scope__"}.getJSONObject("state")
            val settlement=entry.getJSONObject("payload").getString("operationType") in setOf("SettlementGrant.Use","SettlementGrant.Return")
            val payload=if(settlement)JSONObject().put("sourceEntryId",entry.getString("entryId")).put("sourceHash",entry.getString("payloadHash")).put("sourceDeviceId",peer).put("sourceDeviceEpoch",entry.getString("deviceEpoch")).put("sourceSequence",entry.getString("sequence")) else JSONObject().put("originalJournal",entry)
            val operationId=(if(settlement)"settlement-" else "capture-")+io.mekoniq.tablet.storage.JournalDatabase.hash(JSONObject().put("entryId",entry.getString("entryId"))).take(32)
            val command=JSONObject(scope.toString()).put("schemaVersion",1).put("operationId",operationId).put("type",if(settlement)"Sync.SettlementObservation" else "Sync.ContinuityObservation").put("actorRef",if(settlement)"settlement-sync" else "continuity-sync").put("deviceId",authority.getString("ownerDeviceId")).put("deviceEpoch",authority.getString("deviceEpoch")).put("coordinatorEpoch",authority.getInt("coordinatorEpoch")).put("policyRevision",authority.getInt("policyRevision")).put("occurredAt",entry.getString("occurredAt")).put("recordedAt",java.time.Instant.now().toString()).put("payload",payload).put("payloadHash",io.mekoniq.tablet.storage.JournalDatabase.hash(payload))
            val result=RuntimeQueue.submit(command,JSONObject().put("__settlementEntry",entry))
            json(if(result.optString("status")=="accepted")Response.Status.OK else Response.Status.SERVICE_UNAVAILABLE,JSONObject(result.toString()).put("operationId",entry.getString("operationId")).put("sourceEntryId",entry.getString("entryId")).put("sourceHash",entry.getString("payloadHash")))
          }
          session.method==Method.GET && session.uri=="/v1/snapshots" -> {
            require(RuntimeQueue.ready()) { "RUNTIME_UNAVAILABLE" }
            val grant=pairing.actorGrant(peer);val permissions=grant.getJSONArray("permissions")
            val allowed=(0 until permissions.length()).map {permissions.getString(it)}
            val scope=JSONObject().put("organizationId",organizationId).put("venueId",venueId)
            val all=io.mekoniq.tablet.storage.JournalDatabase(context).use {it.snapshots(scope)}
            val selected=org.json.JSONArray();var revision=0;var coordinatorEpoch=0
            for(index in 0 until all.length()) {
              val snapshot=all.getJSONObject(index);val kind=snapshot.getJSONObject("ref").getString("kind")
              if(kind=="__scope__"){revision=snapshot.getInt("version");coordinatorEpoch=snapshot.getJSONObject("state").getInt("coordinatorEpoch")}
              val visible=if("*" in allowed||"continuity.resolve" in allowed)true else if("billing.write" in allowed)kind in setOf("__scope__","configuration","catalog","table","session","order","fulfillment","allocation","mission","robot","bill","payment","shift","cashier-shift","grant","device") else kind in setOf("__scope__","configuration","catalog","station","kitchen-ticket","fulfillment")
              if(!visible)continue
              if("kitchen.write" in allowed && "billing.write" !in allowed && "*" !in allowed && snapshot.getJSONObject("state").has("stationId")) {
                val stations=grant.optJSONArray("stationIds") ?: org.json.JSONArray()
                if((0 until stations.length()).none {stations.getString(it)==snapshot.getJSONObject("state").getString("stationId")})continue
              }
              selected.put(snapshot)
            }
            val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
            val keys=DeviceKeys(context)
            val bundle=JSONObject(scope.toString()).put("coordinatorEpoch",coordinatorEpoch).put("revision",revision).put("snapshots",selected).put("issuerDeviceId",config.getString("deviceId")).put("issuerDeviceEpoch",keys.deviceEpoch()).put("issuedAt",java.time.Instant.now().toString())
            val signature=DeviceKeys.base64(keys.sign(io.mekoniq.tablet.storage.JournalDatabase.canonical(bundle)))
            require(bundle.toString().toByteArray().size<=1024*1024) { "PROJECTION_TOO_LARGE" }
            json(Response.Status.OK,JSONObject().put("bundle",bundle).put("signature",signature))
          }
          session.method==Method.POST && session.uri=="/v1/commands" -> {
            val command=io.mekoniq.tablet.storage.JournalDatabase.parseJsonStrict(body)
            require(command.getString("organizationId")==organizationId && command.getString("venueId")==venueId && command.getString("deviceId")==peer) { "SCOPE_MISMATCH" }
            val authorization=pairing.actorGrant(peer)
            require(command.getString("actorRef")==authorization.getString("actorRef") && command.getString("deviceEpoch")==authorization.getString("deviceEpoch")) { "ACTOR_MISMATCH" }
            val result=RuntimeQueue.submit(command,authorization)
            json(if(result.optString("status")=="unknown")Response.Status.SERVICE_UNAVAILABLE else Response.Status.OK,result)
          }
          else -> json(Response.Status.NOT_FOUND,JSONObject().put("code","NOT_FOUND"))
        }
      } catch(_:Exception) { json(Response.Status.FORBIDDEN,JSONObject().put("code","INVALID_DEVICE_REQUEST")) }
    }
    private fun readBody(session:IHTTPSession):String {
      val length=session.headers["content-length"]?.toIntOrNull() ?: 0
      require(length in 0..262144) { "PAYLOAD_TOO_LARGE" }
      require(session.headers["transfer-encoding"]==null) { "CHUNKED_BODY_UNSUPPORTED" }
      val bytes=ByteArray(length);var read=0
      while(read<length) { val n=session.inputStream.read(bytes,read,length-read);require(n>0);read+=n }
      return String(bytes,Charsets.UTF_8)
    }
    private fun authenticate(session:IHTTPSession,body:String):String {
      val proof=JSONObject(String(DeviceKeys.decode(session.headers["x-device-proof"] ?: error("MISSING_PROOF")),Charsets.UTF_8))
      val hash=java.security.MessageDigest.getInstance("SHA-256").digest(body.toByteArray()).joinToString("") { "%02x".format(it) }
      return pairing.authorize(proof,session.headers["x-device-signature"] ?: error("MISSING_SIGNATURE"),session.method.name,session.uri,hash,organizationId,venueId)
    }
    override fun openWebSocket(handshake:IHTTPSession):WebSocket {
      require(handshake.uri=="/v1/events");authenticate(handshake,"")
      return object:WebSocket(handshake) {
        private var unsubscribe:(()->Unit)?=null
        override fun onOpen() { unsubscribe=RuntimeQueue.subscribe { send(JSONObject().put("type","catch_up_required").toString()) };send(JSONObject().put("type","catch_up_required").toString()) }
        override fun onClose(code:WebSocketFrame.CloseCode?,reason:String?,initiatedByRemote:Boolean) { unsubscribe?.invoke();unsubscribe=null }
        override fun onMessage(message:WebSocketFrame?) { send(JSONObject().put("type","catch_up_required").toString()) }
        override fun onPong(pong:WebSocketFrame?) {}
        override fun onException(exception:IOException?) { close(WebSocketFrame.CloseCode.InternalServerError,"transport unavailable",false) }
      }
    }
    override fun stop() { super.stop();pairing.close() }
    private fun json(status:Response.Status,body:JSONObject)=newFixedLengthResponse(status,"application/json",body.toString()).apply { addHeader("Cache-Control","no-store") }
  }
}
