package io.mekoniq.tablet

import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import io.mekoniq.tablet.export.JournalExport
import io.mekoniq.tablet.storage.JournalDatabase
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
class ArchiveTest {
 @Test fun fullArchiveRetainsReceiptsAndCountersWithoutReplayingEffects() {
  val context=RuntimeEnvironment.getApplication() as Context
  val generator=KeyPairGenerator.getInstance("EC");generator.initialize(ECGenParameterSpec("secp256r1"));val pair=generator.generateKeyPair()
  val jwk=ECKey.Builder(Curve.P_256,pair.public as ECPublicKey).build().toPublicJWK().toJSONString()
  val config=Bundle().apply {putString("organizationId","org-a");putString("venueId","venue-a");putString("deviceId","device-a");putString("restoreProducerJwk",jwk)}
  Shadows.shadowOf(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).setApplicationRestrictions(config)
  val signer:(ByteArray)->ByteArray={bytes->val signature=Signature.getInstance("SHA256withECDSA");signature.initSign(pair.private);signature.update(bytes);ECDSA.transcodeSignatureToConcat(signature.sign(),64)}
  JournalDatabase.testDatabase(context,signer).use {db ->
   val batch=testBatch("saved-operation",0);db.commit(batch)
   val journalId=db.exportRows().getJSONObject(0).getJSONObject("entry").getString("entryId")
   db.writableDatabase.execSQL("INSERT INTO outbox(id,journal_entry_id,kind,payload_json,status) VALUES(?,?,?,?,?)",arrayOf("effect-1",journalId,"robot.execute","{}","dispatching"))
   val grant=JSONObject().put("id","grant-1").put("status","issued").put("amountMinor","50000").put("spentMinor","0")
   db.writableDatabase.execSQL("INSERT INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf("org-a","venue-a","grant","grant-1",1,grant.toString()))
   val snapshot=JournalExport.snapshot(context,db,"epoch-a")
   val encrypted=JournalExport.encrypt(context,snapshot,"separate-long-password".toCharArray(),signer)
   val inspected=JournalExport.decrypt(context,encrypted,"separate-long-password".toCharArray())
   assertThrows(Exception::class.java) {JournalExport.decrypt(context,encrypted,"another-long-password".toCharArray())}
   val restored=JournalExport.restoreInactive(context,inspected);assertFalse(restored.getBoolean("active"))
   val restoredName=restored.getString("stagedDatabase")
   JournalDatabase(context,restoredName,signer).use {target ->
    assertNotNull(target.receipt(JSONObject().put("organizationId","org-a").put("venueId","venue-a"),"saved-operation",batch.getJSONObject("command").getString("payloadHash"),batch.getJSONObject("command")))
    assertEquals(1,target.journalCount())
    assertEquals("unknown",target.effects(JSONObject().put("organizationId","org-a").put("venueId","venue-a"),"robot.execute").getJSONObject(0).getString("status"))
    val restoredGrant=target.readSnapshot(JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("kind","grant").put("id","grant-1")).getJSONObject("state")
    assertTrue(restoredGrant.getBoolean("restorationIncomplete"));assertEquals("unknown",restoredGrant.getString("status"))
    assertFalse(target.claimEffect(JSONObject().put("organizationId","org-a").put("venueId","venue-a"),"effect-1"))
   }
   context.deleteDatabase(restoredName)
  }
 }
}
