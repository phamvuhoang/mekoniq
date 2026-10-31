package io.mekoniq.tablet

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ActivityScenario
import io.mekoniq.tablet.identity.DeviceKeys
import io.mekoniq.tablet.lan.NativePeerTransport
import io.mekoniq.tablet.lan.PairingRegistry
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Explicit debug/emulator fixture. No listener or business reducer is implemented in this test. */
class NativeLabFixtureTest {
 @Test fun runLabAction() {
  require(BuildConfig.DEBUG) {"DEBUG_APK_REQUIRED"}
  val instrument=InstrumentationRegistry.getInstrumentation();val context=instrument.targetContext
  val arguments=InstrumentationRegistry.getArguments();val action=arguments.getString("action") ?: error("LAB_ACTION_REQUIRED")
  val result=when(action) {
   "resetIdentity" -> {
    // Only disposable, debug device-owner fixtures may remove their synthetic enrollment.
    require(android.os.Build.FINGERPRINT.contains("generic") || android.os.Build.MODEL.contains("sdk_gphone")) {"EMULATOR_REQUIRED"}
    require((context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager).isDeviceOwnerApp(context.packageName)) {"DEBUG_DEVICE_OWNER_REQUIRED"}
    java.security.KeyStore.getInstance("AndroidKeyStore").apply {load(null);deleteEntry("mekoniq-device-v1")}
    require(context.getSharedPreferences("device-identity",0).edit().remove("mekoniq-device-v1.epoch").remove("offlineGrant").remove("pairingGrant").commit())
    context.deleteDatabase("mekoniq-journal.db");context.deleteDatabase("mekoniq-pairing.db")
    JSONObject().put("reset",true)
   }
   "prepareChecks" -> {
    require(android.os.Build.MODEL.contains("sdk_gphone")) {"EMULATOR_REQUIRED"}
    val dpm=context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    require(dpm.isDeviceOwnerApp(context.packageName)) {"DEBUG_DEVICE_OWNER_REQUIRED"}
    dpm.setApplicationRestrictions(ComponentName(context,"io.mekoniq.tablet.lab.TestDeviceOwnerReceiver"),context.packageName,Bundle())
    java.security.KeyStore.getInstance("AndroidKeyStore").apply {load(null);deleteEntry("mekoniq-test");deleteEntry("mekoniq-test-golden")}
    JSONObject().put("checksPrepared",true)
   }
   "identity" -> {
    val keys=DeviceKeys(context)
    val privateKey=java.security.KeyStore.getInstance("AndroidKeyStore").apply {load(null)}.getKey("mekoniq-device-v1",null) as java.security.PrivateKey
    val keyInfo=java.security.KeyFactory.getInstance(privateKey.algorithm,"AndroidKeyStore").getKeySpec(privateKey,android.security.keystore.KeyInfo::class.java)
    JSONObject().put("digests",JSONArray(keyInfo.digests.toList())).put("jwk",JSONObject(keys.publicJwk())).put("deviceEpoch",keys.deviceEpoch()).put("certificateFingerprint",PairingRegistry.fingerprint(keys.certificateBytes())).put("hardwareBacked",keys.isHardwareBacked())
   }
   "install" -> {
    val fixture=JSONObject(String(DeviceKeys.decode(arguments.getString("fixture") ?: error("FIXTURE_REQUIRED")),Charsets.UTF_8))
    val profile=fixture.getJSONObject("restrictions")
    require(profile.getString("organizationId").startsWith("org-mekoniq-emulator-")) {"ISOLATED_LAB_TENANT_REQUIRED"}
    val dpm=context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    require(dpm.isDeviceOwnerApp(context.packageName)) {"DEBUG_DEVICE_OWNER_REQUIRED"}
    val restrictions=Bundle()
    profile.keys().forEach {key->when(val value=profile.get(key)){is Boolean->restrictions.putBoolean(key,value);is Number->restrictions.putInt(key,value.toInt());is String->restrictions.putString(key,value);else->error("INVALID_RESTRICTION")}}
    dpm.setApplicationRestrictions(ComponentName(context,"io.mekoniq.tablet.lab.TestDeviceOwnerReceiver"),context.packageName,restrictions)
    val saved=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    require(saved.getString("deviceId")==profile.getString("deviceId")) {"RESTRICTIONS_NOT_APPLIED"}
    val grant=fixture.getJSONObject("offlineGrant");val issuer=profile.getString("enrollmentIssuerJwk")
    require(DeviceKeys.verify(issuer,JournalDatabase.canonical(grant.getJSONObject("payload")),DeviceKeys.decode(grant.getString("signature"))))
    val pair=fixture.getJSONObject("pairingGrant")
    require(DeviceKeys.verify(issuer,JournalDatabase.canonical(pair.getJSONObject("grant")),DeviceKeys.decode(pair.getString("signature"))))
    require(grant.getJSONObject("payload").getString("deviceEpoch")==DeviceKeys(context).deviceEpoch())
    require(context.getSharedPreferences("device-identity",0).edit().putString("offlineGrant",grant.toString()).putString("pairingGrant",pair.toString()).commit())
    context.deleteDatabase("mekoniq-journal.db");context.deleteDatabase("mekoniq-pairing.db")
    JournalDatabase(context).use {db->
     val authority=fixture.getJSONObject("authority");db.provisionSigned(authority.getJSONObject("grant"),authority.getString("signature"))
     val snapshots=fixture.getJSONArray("snapshots");val sql=db.writableDatabase;sql.beginTransaction()
     try{for(index in 0 until snapshots.length()) {
      val snapshot=snapshots.getJSONObject(index)
      sql.execSQL("INSERT OR REPLACE INTO aggregate_snapshot(organization_id,venue_id,kind,id,version,state_json) VALUES(?,?,?,?,?,?)",arrayOf(profile.getString("organizationId"),profile.getString("venueId"),snapshot.getString("kind"),snapshot.getString("id"),snapshot.optInt("version",1),snapshot.getJSONObject("state").toString()))
     };sql.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(profile.getString("organizationId"),profile.getString("venueId")));sql.setTransactionSuccessful()}finally{sql.endTransaction()}
    }
    JSONObject().put("installed",true).put("deviceId",profile.getString("deviceId"))
   }
   "offer" -> {
    val profile=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    PairingRegistry(context).use {it.offer(profile.getString("ownerEndpoint")!!,profile.getString("organizationId")!!,profile.getString("venueId")!!)}
   }
   "pair" -> {
    val offer=JSONObject(String(DeviceKeys.decode(arguments.getString("offer") ?: error("OFFER_REQUIRED")),Charsets.UTF_8))
    val paired=NativePeerTransport(context).pair(offer);assertTrue(paired.toString(),paired.optBoolean("paired"));paired
   }
   "send" -> withPeerRuntime(context) {
    val commands=JSONArray(String(DeviceKeys.decode(arguments.getString("commands") ?: error("COMMANDS_REQUIRED")),Charsets.UTF_8))
    val responses=JSONArray();val transport=NativePeerTransport(context)
    for(index in 0 until commands.length())responses.put(transport.send(commands.getJSONObject(index)))
    JSONObject().put("responses",responses)
   }
   "sendRaw" -> {
    val command=JSONObject(String(DeviceKeys.decode(arguments.getString("command") ?: error("COMMAND_REQUIRED")),Charsets.UTF_8))
    // Exercise owner dedup across an actual TLS retry instead of the peer's cached receipt.
    val method=NativePeerTransport::class.java.getDeclaredMethod("request",String::class.java,String::class.java,JSONObject::class.java);method.isAccessible=true
    method.invoke(NativePeerTransport(context),"/v1/commands","POST",command) as JSONObject
   }
   "inspect" -> {
    val profile=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val scope=JSONObject().put("organizationId",profile.getString("organizationId")).put("venueId",profile.getString("venueId"))
    JournalDatabase(context).use {db->JSONObject().put("orders",db.events(scope,"OrderAccepted").length()).put("sessions",db.events(scope,"SessionOpened").length()).put("pending",db.pendingOutbox().length()).put("snapshots",db.snapshots(scope))}
   }
   else -> error("UNKNOWN_LAB_ACTION")
  }
  instrument.sendStatus(0,Bundle().apply{putString("MEKONIQ_RESULT",result.toString())})
 }
 private fun <T> withPeerRuntime(context:Context,action:()->T):T {
  require(!(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions.getBoolean("coordinatorEnabled",false)) {"PEER_REQUIRED"}
  return ActivityScenario.launch(MainActivity::class.java).use {scenario->
   val limit=System.currentTimeMillis()+20000;var ready=false
   while(System.currentTimeMillis()<limit&&!ready) {
    val done=CountDownLatch(1)
    scenario.onActivity {activity->activity.bridge.webView.evaluateJavascript("Boolean(document.querySelector('nav'))"){ready=it=="true";done.countDown()}}
    require(done.await(3,TimeUnit.SECONDS)) {"PEER_WEBVIEW_UNAVAILABLE"}
    if(!ready)Thread.sleep(150)
   }
   require(ready) {"PEER_DOMAIN_RUNTIME_NOT_READY"};action()
  }
 }
}
