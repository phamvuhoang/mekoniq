package io.mekoniq.tablet

import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import io.mekoniq.tablet.storage.JournalDatabase
import io.mekoniq.tablet.identity.DeviceKeys
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.crypto.impl.ECDSA
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class ProvisioningTest {
  @Test fun signedCloudAuthorityBootstrapsOfflineAndCannotOverwriteOwnerOnRestart() {
    val context=RuntimeEnvironment.getApplication() as Context
    val generator=KeyPairGenerator.getInstance("EC");generator.initialize(ECGenParameterSpec("secp256r1"));val issuer=generator.generateKeyPair()
    val jwk=ECKey.Builder(Curve.P_256,issuer.public as ECPublicKey).build().toPublicJWK().toJSONString()
    val config=Bundle().apply {putString("enrollmentIssuerJwk",jwk);putString("organizationId","org-a");putString("venueId","venue-a");putString("deviceId","device-a")}
    Shadows.shadowOf(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).setApplicationRestrictions(config)
    val grant=JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("deviceEpoch","epoch-local").put("coordinatorEpoch",1).put("policyRevision",1).put("ownerDeviceId","coordinator").put("ownerDeviceEpoch","owner-epoch").put("publicJwk",JSONObject(jwk)).put("expiresAt",java.time.Instant.now().plusSeconds(3600).toString())
    fun signed(value:JSONObject):String {val signature=Signature.getInstance("SHA256withECDSA");signature.initSign(issuer.private);signature.update(JournalDatabase.canonical(value));return DeviceKeys.base64(ECDSA.transcodeSignatureToConcat(signature.sign(),64))}
    val name="provision-${java.util.UUID.randomUUID()}.db"
    JournalDatabase(context,name,{DeviceKeys.decode(signedBytes(it,issuer.private))},{"epoch-local"},{jwk}).use {it.provisionSigned(grant,signed(grant))}
    JournalDatabase(context,name,{DeviceKeys.decode(signedBytes(it,issuer.private))},{"epoch-local"},{jwk}).use {db ->
      val snapshots=db.snapshots(JSONObject().put("organizationId","org-a").put("venueId","venue-a"))
      assertEquals("coordinator",(0 until snapshots.length()).map {snapshots.getJSONObject(it)}.first {it.getJSONObject("ref").getString("kind")=="__scope__"}.getJSONObject("state").getString("ownerDeviceId"))
      val checkpoint=db.checkpoint()
      assertEquals("complete",checkpoint.getString("status"));assertEquals("0",checkpoint.getString("coveredSequence"))
      val stable=db.snapshots(JSONObject().put("organizationId","org-a").put("venueId","venue-a"))
      db.checkpoint()
      val refreshed=db.snapshots(JSONObject().put("organizationId","org-a").put("venueId","venue-a"))
      val stableCheckpoint=(0 until stable.length()).map {stable.getJSONObject(it)}.first {it.getJSONObject("ref").getString("kind")=="device-checkpoint"}
      val freshCheckpoint=(0 until refreshed.length()).map {refreshed.getJSONObject(it)}.first {it.getJSONObject("ref").getString("kind")=="device-checkpoint"}
      assertEquals(stableCheckpoint.getInt("version"),freshCheckpoint.getInt("version"))
      val forged=JSONObject(checkpoint.toString()).put("pendingCount",1)
      assertThrows(IllegalArgumentException::class.java){db.installCheckpoint(forged)}
      val changed=JSONObject(grant.toString()).put("coordinatorEpoch",2)
      assertThrows(IllegalArgumentException::class.java){db.provisionSigned(changed,signed(changed))}
      val proof=JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("handoffId","handoff-a").put("checkpointHash","hash-a").put("resourceId","coordinator").put("status","fenced").put("oldEpoch",1).put("newEpoch",2).put("oldOwnerDeviceId","coordinator").put("newOwnerDeviceId","device-a")
      proof.put("signature",signed(proof))
      val higher=JSONObject(changed.toString()).put("previousCoordinatorEpoch",1).put("handoffId","handoff-a").put("fencingProofs",org.json.JSONArray().put(proof)).put("ownerDeviceId","device-a").put("ownerDeviceEpoch","epoch-local")
      val ownershipRef=JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("kind","ownership").put("id","venue-a")
      db.writableDatabase.execSQL("INSERT INTO aggregate_snapshot VALUES('org-a','venue-a','ownership','venue-a',2,?)",arrayOf(JSONObject().put("status","preparing").put("handoffId","handoff-a").toString()))
      assertEquals("HANDOFF_RECEIPT_CHECKPOINT_REQUIRED",assertThrows(IllegalArgumentException::class.java){db.provisionSigned(higher,signed(higher))}.message)
      val active=JSONObject().put("status","active").put("owner","device-a").put("deviceEpoch","epoch-local").put("epoch",2).put("handoffId","handoff-a").put("fenced",true).put("cursorComplete",true).put("executorEpochAck",true).put("proofs",org.json.JSONArray().put(proof))
      val sourceName="handoff-source-${java.util.UUID.randomUUID()}.db"
      config.putString("deviceId","coordinator");Shadows.shadowOf(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).setApplicationRestrictions(config)
      val original=testBatch("original-accepted",0);original.getJSONObject("command").put("deviceId","coordinator").put("deviceEpoch","owner-epoch")
      val originalEntries=JournalDatabase(context,sourceName,{DeviceKeys.decode(signedBytes(it,issuer.private))},{"owner-epoch"},{jwk}).use {source ->
        val sourceGrant=JSONObject(grant.toString()).put("deviceEpoch","owner-epoch")
        source.provisionSigned(sourceGrant,signed(sourceGrant));source.commit(original)
        source.journal(JSONObject().put("organizationId","org-a").put("venueId","venue-a"))
      }
      config.putString("deviceId","device-a");Shadows.shadowOf(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).setApplicationRestrictions(config)
      higher.put("handoffSnapshots",org.json.JSONArray().put(JSONObject().put("ref",ownershipRef).put("version",3).put("state",active)))
        .put("handoffEntries",originalEntries).put("handoffProducerKeys",org.json.JSONArray().put(JSONObject().put("deviceId","coordinator").put("deviceEpoch","owner-epoch").put("publicJwk",JSONObject(jwk))))
        .put("handoffReceiptsComplete",true).put("handoffReceiptCount",1)
      val deviceRef=JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("kind","device").put("id","coordinator")
      val oldDevice=db.readSnapshot(deviceRef).getJSONObject("state").put("certificateFingerprint","paired-fingerprint")
      db.writableDatabase.execSQL("UPDATE aggregate_snapshot SET version=4,state_json=? WHERE kind='device' AND id='coordinator'",arrayOf(oldDevice.toString()))
      val signedInventory=JSONObject(oldDevice.toString());signedInventory.remove("certificateFingerprint")
      higher.getJSONArray("handoffSnapshots").put(JSONObject().put("ref",deviceRef).put("version",1).put("state",signedInventory))
      val incomplete=JSONObject(higher.toString()).put("handoffReceiptCount",2)
      assertEquals("HANDOFF_RECEIPT_COUNT_MISMATCH",assertThrows(IllegalArgumentException::class.java){db.provisionSigned(incomplete,signed(incomplete))}.message)
      assertEquals("preparing",db.readSnapshot(ownershipRef).getJSONObject("state").getString("status"))
      assertEquals(0,db.journalCount())

      db.provisionSigned(higher,signed(higher))
      assertEquals("active",db.readSnapshot(ownershipRef).getJSONObject("state").getString("status"))
      assertEquals(3,db.readSnapshot(ownershipRef).getInt("version"))
      assertEquals(4,db.readSnapshot(deviceRef).getInt("version"))
      assertEquals("paired-fingerprint",db.readSnapshot(deviceRef).getJSONObject("state").getString("certificateFingerprint"))
      val replay=db.commit(original)
      assertTrue(replay.getBoolean("duplicate"));assertEquals(1,db.journalCount())
      assertEquals("accepted",replay.getJSONObject("result").getString("status"))
      assertEquals(0,db.effects(JSONObject().put("organizationId","org-a").put("venueId","venue-a"),"robot.execute").length())
      context.deleteDatabase(sourceName)
      assertThrows(IllegalArgumentException::class.java){db.provisionSigned(grant,signed(grant))}
      val tampered=JSONObject(grant.toString()).put("venueId","venue-b")
      assertThrows(IllegalArgumentException::class.java){db.provisionSigned(tampered,signed(tampered))}
    }
    context.deleteDatabase(name)
  }
  private fun signedBytes(value:ByteArray,key:java.security.PrivateKey):String {val signature=Signature.getInstance("SHA256withECDSA");signature.initSign(key);signature.update(value);return DeviceKeys.base64(ECDSA.transcodeSignatureToConcat(signature.sign(),64))}
  @Test fun duplicateJsonKeysCannotChangeSignedIngressMeaning() {
    assertThrows(Exception::class.java) {JournalDatabase.parseJsonStrict("{\"operationId\":\"one\",\"operationId\":\"two\"}")}
  }
}
