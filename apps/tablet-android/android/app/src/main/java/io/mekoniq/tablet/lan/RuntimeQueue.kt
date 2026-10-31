package io.mekoniq.tablet.lan

import android.os.SystemClock
import org.json.JSONObject
import org.json.JSONArray
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.UUID

object RuntimeQueue {
  data class Request(val id: String,val command: JSONObject,val authorization:JSONObject,val response: CompletableFuture<JSONObject>)
  private val queue=ArrayBlockingQueue<Request>(100)
  private val pending=ConcurrentHashMap<String,Request>()
  @Volatile private var heartbeatMs=0L
  @Volatile private var writable=false
  @Volatile private var foreground=false
  @Volatile var serviceUp=false
  fun heartbeat(storeWritable: Boolean) { heartbeatMs=SystemClock.elapsedRealtime();writable=storeWritable }
  fun resumeRuntime() {foreground=true}
  fun suspendRuntime() { foreground=false;heartbeatMs=0L }
  fun ready(): Boolean = serviceUp && foreground && writable && heartbeatMs>0 && SystemClock.elapsedRealtime()-heartbeatMs in 0..2000
  fun submit(command: JSONObject,authorization:JSONObject=JSONObject()): JSONObject {
    if (!ready()) return unknown(command,"RUNTIME_UNAVAILABLE")
    val request=Request(UUID.randomUUID().toString(),command,authorization,CompletableFuture())
    if(!queue.offer(request)) return unknown(command,"QUEUE_FULL")
    pending[request.id]=request
    return try { request.response.get(5,TimeUnit.SECONDS) }
    catch(_:Exception) { unknown(command,"RESPONSE_TIMEOUT") }
    finally { pending.remove(request.id);queue.remove(request) }
  }
  fun poll(): JSONArray = JSONArray().apply {
    repeat(20) {
      val request=queue.poll() ?: return@apply
      if(pending.containsKey(request.id)) put(JSONObject().put("id",request.id).put("command",request.command).put("authorization",request.authorization))
    }
  }
  fun request(id: String): Request = pending[id] ?: error("REQUEST_EXPIRED")
  private val listeners=java.util.concurrent.CopyOnWriteArraySet<()->Unit>()
  fun subscribe(listener:()->Unit):()->Unit { require(listeners.size<100){"SUBSCRIPTION_CAPACITY"};listeners.add(listener);return {listeners.remove(listener)} }
  fun complete(id: String,result: JSONObject) { request(id).response.complete(result);if(result.optString("status")=="accepted")listeners.forEach { listener -> runCatching { listener() } } }
  fun unknown(command: JSONObject,code: String): JSONObject = JSONObject().put("status","unknown").put("code",code).put("ack","none").put("operationId",command.optString("operationId")).put("value",JSONObject()).put("duplicate",false)
}
