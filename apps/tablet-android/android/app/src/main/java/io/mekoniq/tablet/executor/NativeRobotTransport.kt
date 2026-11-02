package io.mekoniq.tablet.executor

import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI

/**
 * The only code on the tablet that sends robot mutations: Valetudo REST v2 (pinned 2026.10.0) to the provisioned LAN origin. Routes and
 * shapes mirror packages/robot-adapters/src/valetudo/{capabilities,map,rest}.ts. No redirects, bounded bodies (after gzip inflation), short
 * timeouts. MQTT is not implemented natively (no client library on the tablet); a profile asking for it is refused.
 */
class NativeRobotTransport(endpoint:String,private val timeoutMs:Int=2000,private val maxMapBytes:Int=1 shl 20) {
  val origin=lanOrigin(endpoint)
  data class Response(val status:Int,val body:String)
  private fun request(method:String,path:String,body:JSONObject?=null,maxBytes:Int=65536):Response {
    val connection=(URI(origin+path).toURL().openConnection() as HttpURLConnection).apply {
      instanceFollowRedirects=false;connectTimeout=timeoutMs;readTimeout=timeoutMs;requestMethod=method;useCaches=false
      setRequestProperty("Accept","application/json")
      if(body!=null) { doOutput=true;setRequestProperty("Content-Type","application/json") }
    }
    try {
      if(body!=null) connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val status=connection.responseCode
      val stream=(if(status<400) connection.inputStream else connection.errorStream) ?: return Response(status,"")
      val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
      stream.use { input -> while(true) { val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n);require(out.size()<=maxBytes) {"MAP_TOO_LARGE"} } }
      return Response(status,out.toString(Charsets.UTF_8.name()))
    } finally { connection.disconnect() }
  }
  fun capabilities():List<String> {
    val r=request("GET","/api/v2/robot/capabilities");require(r.status==200) {"CAPABILITIES_UNAVAILABLE"}
    val list=JSONArray(r.body);return (0 until list.length()).map { list.getString(it) }
  }
  /** "accepted" only on HTTP 200 (firmware took the request, nothing about arrival); "rejected" on 400; anything else "unknown". */
  fun goto(x:Long,y:Long):String = try {
    when(request("PUT","/api/v2/robot/capabilities/GoToLocationCapability",JSONObject().put("action","goto").put("coordinates",JSONObject().put("x",x).put("y",y))).status) { 200->"accepted";400->"rejected";else->"unknown" }
  } catch(_:Exception) { "unknown" }
  fun stop():String = try {
    when(request("PUT","/api/v2/robot/capabilities/BasicControlCapability",JSONObject().put("action","stop")).status) { 200->"acknowledged";400->"rejected";else->"unknown" }
  } catch(_:Exception) { "unknown" }
  /** One observation, stamped with the executor's receive time (Valetudo state has no timestamp). */
  fun sample(receivedAtMs:Long):JSONObject = try {
    val attributes=request("GET","/api/v2/robot/state/attributes");val map=request("GET","/api/v2/robot/state/map",null,maxMapBytes);val host=request("GET","/api/v2/system/host/info")
    require(attributes.status==200&&map.status==200&&host.status==200) {"TELEMETRY_UNAVAILABLE"}
    parseSample(JSONArray(attributes.body),JSONObject(map.body),JSONObject(host.body),receivedAtMs)
  } catch(e:Exception) { JSONObject().put("receivedAtMs",receivedAtMs).put("reachable",false).put("error",e.message ?: "UNREACHABLE") }
  companion object {
    private val STATUS=setOf("error","docked","idle","returning","cleaning","paused","manual_control","moving")
    /** Same rule as lanEndpoint() in TS: http(s) origin on 10/8, 172.16/12, 192.168/16 or `<name>.local`; no credentials, path, query. */
    fun lanOrigin(raw:String):String {
      val uri=try { URI(raw) } catch(_:Exception) { error("INVALID_ENDPOINT") }
      require(uri.scheme in setOf("http","https")&&uri.rawUserInfo==null&&uri.rawQuery==null&&uri.rawFragment==null&&(uri.rawPath.isNullOrEmpty()||uri.rawPath=="/")) {"INVALID_ENDPOINT"}
      val host=uri.host ?: error("INVALID_ENDPOINT")
      val octets=host.split('.').map { it.toIntOrNull() }
      val lan=if(octets.size==4&&octets.all { it!=null&&it in 0..255 }) { val (a,b)=octets[0]!! to octets[1]!!;a==10||(a==172&&b in 16..31)||(a==192&&b==168) } else Regex("^[a-z0-9-]{1,63}\\.local$",RegexOption.IGNORE_CASE).matches(host)
      require(lan) {"ENDPOINT_NOT_LAN"}
      return "${uri.scheme}://$host${if(uri.port>0)":${uri.port}" else ""}"
    }
    private fun point(entity:JSONObject?):JSONObject? { val p=entity?.optJSONArray("points") ?: return null;if(p.length()!=2)return null;return JSONObject().put("x",p.getDouble(0)).put("y",p.getDouble(1)) }
    /** Mirror of map.ts parseMap/parseStatus: fingerprint = sha256(JCS{size,pixelSize,segments}) — a change detector, not a map identity. */
    fun parseSample(attributes:JSONArray,map:JSONObject,host:JSONObject,receivedAtMs:Long):JSONObject {
      val status=(0 until attributes.length()).map { attributes.getJSONObject(it) }.firstOrNull { it.optString("__class")=="StatusStateAttribute" } ?: error("STATUS_UNAVAILABLE")
      require(status.getString("value") in STATUS) {"STATUS_UNAVAILABLE"}
      require(map.getJSONObject("metaData").getInt("version")==2) {"UNSUPPORTED_MAP_VERSION"}
      val layers=map.getJSONArray("layers");val entities=map.getJSONArray("entities")
      val segments=(0 until layers.length()).map { layers.getJSONObject(it) }.filter { it.optString("type")=="segment" }.map { it.optJSONObject("metaData")?.optString("segmentId","") ?: "" }.sorted()
      val size=map.getJSONObject("size")
      val fingerprint=JournalDatabase.hash(JSONObject().put("size",JSONObject().put("x",size.getInt("x")).put("y",size.getInt("y"))).put("pixelSize",map.getInt("pixelSize")).put("segments",JSONArray(segments)))
      val all=(0 until entities.length()).map { entities.getJSONObject(it) }
      val robot=all.firstOrNull { it.optString("type")=="robot_position" };val target=all.firstOrNull { it.optString("type")=="go_to_target" }
      return JSONObject().put("receivedAtMs",receivedAtMs).put("reachable",true).put("status",status.getString("value")).put("flag",status.optString("flag","none"))
        .put("mapFingerprint",fingerprint).put("uptimeS",host.getDouble("uptime"))
        .apply { point(robot)?.let { p -> robot!!.optJSONObject("metaData")?.optDouble("angle")?.takeIf { a -> a.isFinite() }?.let { a -> p.put("angle",a) };put("position",p) };point(target)?.let { put("goToTarget",it) }
          if(status.getString("value")=="error") put("error",status.optJSONObject("error")?.optString("message","error") ?: "error") }
    }
  }
}
