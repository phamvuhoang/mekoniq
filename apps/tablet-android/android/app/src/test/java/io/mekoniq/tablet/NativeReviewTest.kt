package io.mekoniq.tablet

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import io.mekoniq.tablet.storage.JournalDatabase

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class NativeReviewTest {
  private val context:Context get()=RuntimeEnvironment.getApplication()
  private val scope get()=JSONObject().put("organizationId","org-a").put("venueId","venue-a")
  private val signer:(ByteArray)->ByteArray={java.security.MessageDigest.getInstance("SHA-256").digest(it)}
  @Test fun effectConsumersReadInnerPayloadAcrossDurableReopen() {
    val name="review-effects-${java.util.UUID.randomUUID()}.db"
    val batch=testBatch("dispatch",0)
    val payload=JSONObject().put("operationId","dispatch").put("robotId","robot-a").put("revision",2)
    for(type in listOf("robot.execute","cloud.configurationAck","command.intent"))batch.getJSONArray("effects").put(JSONObject().put("id",type).put("type",type).put("payload",payload))
    JournalDatabase(context,name,signer,{"epoch-a"}).use {it.provisionForTest();it.commit(batch)}
    JournalDatabase(context,name,signer,{"epoch-a"}).use {db->
      for(type in listOf("robot.execute","cloud.configurationAck","command.intent")) {
        val effect=db.effects(scope,type).getJSONObject(0)
        assertEquals("dispatch",effect.getJSONObject("payload").getString("operationId"))
        assertEquals("robot-a",effect.getJSONObject("payload").getString("robotId"))
      }
      val pending=db.pendingOutbox();val intent=(0 until pending.length()).map {pending.getJSONObject(it)}.first {it.getString("kind")=="command.intent"}
      assertEquals("dispatch",intent.getJSONObject("payload").getString("operationId"))
    }
    context.deleteDatabase(name)
  }
  @Test fun existingWrappedEffectsMigrateWithoutResettingDeliveryState() {
    val name="review-legacy-${java.util.UUID.randomUUID()}.db";val batch=testBatch("legacy-operation",0)
    val effect=JSONObject().put("id","legacy-intent").put("type","command.intent").put("payload",batch.getJSONObject("command"))
    batch.getJSONArray("effects").put(effect)
    JournalDatabase(context,name,signer,{"epoch-a"}).use {db->
      db.provisionForTest();db.commit(batch)
      val sql=db.writableDatabase
      sql.execSQL("UPDATE outbox SET payload_json=?,attempts=3,status='unknown' WHERE id='legacy-intent'",arrayOf(effect.toString()))
      sql.execSQL("ALTER TABLE outbox RENAME TO old_outbox")
      sql.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY,journal_entry_id TEXT NOT NULL REFERENCES journal(entry_id),kind TEXT NOT NULL,payload_json TEXT NOT NULL,cloud_ack INTEGER NOT NULL DEFAULT 0,venue_ack INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0)")
      sql.execSQL("INSERT INTO outbox SELECT id,journal_entry_id,kind,payload_json,cloud_ack,venue_ack,status,attempts FROM old_outbox")
      sql.execSQL("DROP TABLE old_outbox");sql.version=1
    }
    JournalDatabase(context,name,signer,{"epoch-a"}).use {db->
      val restored=db.effects(scope,"command.intent").getJSONObject(0)
      assertEquals("legacy-operation",restored.getJSONObject("payload").getString("operationId"))
      assertEquals("legacy-intent",restored.getString("id"));assertEquals(3,restored.getInt("attempts"));assertEquals("unknown",restored.getString("status"))
      assertEquals(1,db.journalCount());assertEquals("accepted",db.receipt(scope,"legacy-operation",batch.getJSONObject("command").getString("payloadHash"))!!.getString("status"))
    }
    context.deleteDatabase(name)
  }
  private fun expiredCheckpoint(db:JournalDatabase):JSONObject {
    db.writableDatabase.execSQL("INSERT INTO aggregate_snapshot VALUES('org-a','venue-a','device','peer',1,?)",arrayOf(JSONObject().put("status","active").put("deviceEpoch","peer-epoch").toString()))
    val ref=JSONObject(scope.toString()).put("kind","device-checkpoint").put("id","peer")
    db.writableDatabase.execSQL("INSERT INTO aggregate_snapshot VALUES('org-a','venue-a','device-checkpoint','peer',1,?)",arrayOf(JSONObject().put("expiresAtMs",0).put("deviceEpoch","peer-epoch").toString()))
    return JSONObject().put("ref",ref).put("expectedVersion",1)
  }
  @Test fun expiredUnrelatedCheckpointDoesNotBlockOrdersOrIsolatedCapture() {
    JournalDatabase.testDatabase(context,signer).use {db->
      val read=expiredCheckpoint(db)
      val order=testBatch("order-after-checkpoint-expiry",0);order.getJSONObject("command").put("type","Order.Place");order.put("expectedReads",JSONArray().put(read))
      assertEquals("accepted",db.commit(order).getJSONObject("result").getString("status"))
      val capture=testBatch("isolated-after-checkpoint-expiry",0);capture.getJSONObject("command").put("type","Continuity.CaptureTicket");capture.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("kind","isolated-ticket");capture.put("expectedReads",JSONArray().put(read))
      assertEquals("accepted",db.commit(capture).getJSONObject("result").getString("status"))
    }
  }
  @Test fun expiredCheckpointCanBeReportedByPreparationButStillFencesSafetyTransition() {
    JournalDatabase.testDatabase(context,signer).use {db->
      val read=expiredCheckpoint(db)
      val prepare=testBatch("prepare-with-missing",0);prepare.getJSONObject("command").put("type","Maintenance.Prepare");prepare.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("kind","maintenance");prepare.getJSONArray("mutations").getJSONObject(0).getJSONObject("newState").put("missingDevices",JSONArray().put("peer"));prepare.put("expectedReads",JSONArray().put(read))
      prepare.getJSONObject("command").put("payloadHash",JournalDatabase.hash(prepare.getJSONObject("command").getJSONObject("payload")))
      db.commit(prepare)
      val activate=testBatch("activate-with-expired-checkpoint",0);activate.getJSONObject("command").put("type","Ownership.Activate");activate.put("expectedReads",JSONArray().put(read))
      assertThrows(io.mekoniq.tablet.storage.VersionConflict::class.java){db.commit(activate)}
      val cloudOnly=testBatch("cloud-maintenance",0);cloudOnly.getJSONObject("command").put("type","Maintenance.Enter");cloudOnly.getJSONObject("command").getJSONObject("payload").put("mode","cloud_only");cloudOnly.getJSONObject("command").put("payloadHash",JournalDatabase.hash(cloudOnly.getJSONObject("command").getJSONObject("payload")));cloudOnly.put("expectedReads",JSONArray().put(read))
      assertEquals("accepted",db.commit(cloudOnly).getJSONObject("result").getString("status"))
    }
  }

  private fun keyPair():java.security.KeyPair=java.security.KeyPairGenerator.getInstance("EC").apply {initialize(java.security.spec.ECGenParameterSpec("secp256r1"))}.generateKeyPair()
  private fun jwk(key:java.security.KeyPair):String=com.nimbusds.jose.jwk.ECKey.Builder(com.nimbusds.jose.jwk.Curve.P_256,key.public as java.security.interfaces.ECPublicKey).build().toPublicJWK().toJSONString()
  private fun sign(key:java.security.KeyPair,value:JSONObject):String {
    val signature=java.security.Signature.getInstance("SHA256withECDSA");signature.initSign(key.private);signature.update(JournalDatabase.canonical(value));return io.mekoniq.tablet.identity.DeviceKeys.base64(com.nimbusds.jose.crypto.impl.ECDSA.transcodeSignatureToConcat(signature.sign(),64))
  }
  private fun projection(key:java.security.KeyPair,revision:Int,configRevision:Int=revision):JSONObject {
    val snapshots=JSONArray().put(JSONObject().put("ref",JSONObject(scope.toString()).put("kind","configuration").put("id","applied")).put("version",1).put("state",JSONObject().put("revision",configRevision)))
      .put(JSONObject().put("ref",JSONObject(scope.toString()).put("kind","__scope__").put("id","authority")).put("version",5).put("state",JSONObject().put("ownerDeviceId","device-a").put("deviceEpoch","epoch-a").put("publicJwk",JSONObject(jwk(key))).put("coordinatorEpoch",1).put("policyRevision",revision)))
    val bundle=JSONObject(scope.toString()).put("coordinatorEpoch",1).put("revision",5).put("snapshots",snapshots).put("issuerDeviceId","device-a").put("issuerDeviceEpoch","epoch-a").put("issuedAt",java.time.Instant.now().toString())
    return JSONObject().put("bundle",bundle).put("signature",sign(key,bundle))
  }
  @Test fun authenticatedProjectionAdvancesPolicyAndRejectsMixedConfigurationAtomically() {
    val key=keyPair()
    JournalDatabase.testDatabase(context,signer).use {db->
      db.writableDatabase.execSQL("UPDATE authority SET public_jwk=?",arrayOf(jwk(key)))
      val mixed=projection(key,2,3)
      assertThrows(IllegalArgumentException::class.java){db.applyRemoteSnapshots(mixed)}
      assertEquals(0,db.readSnapshot(JSONObject(scope.toString()).put("kind","configuration").put("id","applied")).getInt("version"))
      db.applyRemoteSnapshots(projection(key,2))
      val authority=db.snapshots(scope);val actual=(0 until authority.length()).map {authority.getJSONObject(it)}.first {it.getJSONObject("ref").getString("kind")=="__scope__"}
      assertEquals(2,actual.getJSONObject("state").getInt("policyRevision"))
      val old=testBatch("stale-policy",0)
      assertEquals("POLICY_CONFLICT",assertThrows(IllegalStateException::class.java){db.commit(old)}.message)
      val current=testBatch("fresh-policy",0);current.getJSONObject("command").put("policyRevision",2);current.getJSONObject("expectedAuthority").put("policyRevision",2)
      assertEquals("accepted",db.commit(current).getJSONObject("result").getString("status"))
    }
  }

  private fun rawSign(key:java.security.KeyPair,bytes:ByteArray):ByteArray {
    val signature=java.security.Signature.getInstance("SHA256withECDSA");signature.initSign(key.private);signature.update(bytes);return com.nimbusds.jose.crypto.impl.ECDSA.transcodeSignatureToConcat(signature.sign(),64)
  }
  private fun seed(db:JournalDatabase,kind:String,id:String,state:JSONObject,version:Int=1) {db.writableDatabase.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES('org-a','venue-a',?,?,?,?)",arrayOf(kind,id,version,state.toString()))}
  @Test fun coordinatorAcceptsVerifiedRecipientClosureWithoutResigningIt() {
    val coordinator=keyPair();val recipient=keyPair();val now=java.time.Instant.now()
    val restrictions=android.os.Bundle().apply {putString("organizationId","org-a");putString("venueId","venue-a");putString("deviceId","peer");putString("enrollmentIssuerJwk",jwk(coordinator))}
    val manager=context.getSystemService(Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager
    org.robolectric.Shadows.shadowOf(manager).setApplicationRestrictions(restrictions)
    val bill=JSONObject().put("totalMinor","100").put("currency","VND").put("grantId","grant-a").put("collectionLocked",true)
    val grant=JSONObject(scope.toString()).put("schemaVersion",1).put("id","grant-a").put("billId","bill-a").put("billVersion",1).put("billSnapshotHash",JournalDatabase.immutableBillHash("bill-a",bill)).put("deviceId","peer").put("deviceEpoch","peer-epoch").put("issuerDeviceId","device-a").put("issuerDeviceEpoch","epoch-a").put("issuerEpoch",1).put("nonce","grant-nonce").put("currency","VND").put("amountMinor","100").put("methods",JSONArray().put("cash")).put("issuedAt",now.toString()).put("expiresAt",now.plusSeconds(3600).toString()).put("expiresAtMs",now.plusSeconds(3600).toEpochMilli()).put("spentMinor","0").put("status","issued")
    grant.put("signature",sign(coordinator,JournalDatabase.grantCapability(grant)))
    val returned=JSONObject(grant.toString()).put("status","returned").put("returnProofId","grant-a")
    val emptyHash=java.security.MessageDigest.getInstance("SHA-256").digest("[]".toByteArray()).joinToString("") {"%02x".format(it)}
    val proof=JSONObject(scope.toString()).put("schemaVersion",1).put("grantId","grant-a").put("deviceId","peer").put("deviceEpoch","peer-epoch").put("issuerEpoch",1).put("spentMinor","0").put("receiptIds",JSONArray()).put("receiptHash",emptyHash).put("returnedAt",now.toString()).put("signature","")
    fun mutation(kind:String,id:String,version:Int,state:JSONObject)=JSONObject().put("ref",JSONObject(scope.toString()).put("kind",kind).put("id",id)).put("expectedVersion",version).put("newState",state)
    fun event(type:String,kind:String,id:String,state:JSONObject)=JSONObject().put("type",type).put("data",JSONObject().put("kind",kind).put("id",id).put("state",state))
    val sourceName="review-recipient-${java.util.UUID.randomUUID()}.db"
    val sourceEntry=JournalDatabase(context,sourceName,{rawSign(recipient,it)},{"peer-epoch"},{jwk(recipient)}).use {source->
      val authority=JSONObject(scope.toString()).put("deviceEpoch","peer-epoch").put("coordinatorEpoch",1).put("policyRevision",1).put("ownerDeviceId","device-a").put("ownerDeviceEpoch","epoch-a").put("publicJwk",JSONObject(jwk(coordinator))).put("expiresAt",now.plusSeconds(3600).toString())
      source.provisionSigned(authority,sign(coordinator,authority));seed(source,"grant","grant-a",grant);seed(source,"bill","bill-a",bill)
      val batch=testBatch("return-a",0);val command=batch.getJSONObject("command");command.put("type","SettlementGrant.Return").put("deviceId","peer").put("deviceEpoch","peer-epoch").put("payload",JSONObject().put("grantId","grant-a"));command.put("payloadHash",JournalDatabase.hash(command.getJSONObject("payload")))
      batch.put("mutations",JSONArray().put(mutation("grant","grant-a",1,returned)).put(mutation("grant-return","grant-a",0,proof))).put("events",JSONArray().put(event("SettlementGrantReturned","grant","grant-a",returned)).put(event("SettlementGrantReturnRecorded","grant-return","grant-a",proof)))
      source.commit(batch);source.journal(scope).getJSONObject(0)
    }
    restrictions.putString("deviceId","device-a");org.robolectric.Shadows.shadowOf(manager).setApplicationRestrictions(restrictions)
    val name="review-coordinator-${java.util.UUID.randomUUID()}.db"
    JournalDatabase(context,name,{rawSign(coordinator,it)},{"epoch-a"},{jwk(coordinator)}).use {db->
      db.provisionForTest();db.writableDatabase.execSQL("UPDATE authority SET public_jwk=?",arrayOf(jwk(coordinator)))
      seed(db,"grant","grant-a",grant);seed(db,"bill","bill-a",bill);seed(db,"device","peer",JSONObject().put("id","peer").put("deviceEpoch","peer-epoch").put("status","active").put("publicJwk",JSONObject(jwk(recipient))))
      val originalProof=sourceEntry.getJSONObject("payload").getJSONArray("events").getJSONObject(1).getJSONObject("data").getJSONObject("state")
      val provenance=JSONObject().put("originalJournal",sourceEntry);for(field in listOf("entryId","deviceId","deviceEpoch","sequence","payloadHash","signature"))provenance.put(field,sourceEntry.get(field))
      val accepted=JSONObject(originalProof.toString()).put("provenance",provenance)
      val commandPayload=JSONObject().put("sourceEntryId",sourceEntry.getString("entryId")).put("sourceHash",sourceEntry.getString("payloadHash")).put("sourceDeviceId","peer").put("sourceDeviceEpoch","peer-epoch").put("sourceSequence",sourceEntry.getString("sequence"))
      val batch=testBatch("settlement-"+JournalDatabase.hash(JSONObject().put("entryId",sourceEntry.getString("entryId"))).take(32),0)
      batch.getJSONObject("command").put("type","Continuity.AcceptSettlementObservation").put("actorRef","settlement-sync").put("payload",commandPayload).put("payloadHash",JournalDatabase.hash(commandPayload))
      batch.put("mutations",JSONArray().put(mutation("grant-return","grant-a",0,accepted)).put(mutation("grant","grant-a",1,returned))).put("events",JSONArray().put(event("GrantReturnObservationAccepted","grant-return","grant-a",accepted)).put(event("GrantClosedByRecipient","grant","grant-a",returned)))
      val forged=JSONObject(batch.toString());forged.getJSONArray("mutations").getJSONObject(0).getJSONObject("newState").getJSONObject("provenance").getJSONObject("originalJournal").put("signature",sign(coordinator,JSONObject(sourceEntry.toString()).apply {remove("signature")}))
      assertEquals("SETTLEMENT_SOURCE_SIGNATURE_INVALID",assertThrows(IllegalArgumentException::class.java){db.commit(forged)}.message)
      assertEquals(0,db.journalCount());assertEquals("issued",db.readSnapshot(JSONObject(scope.toString()).put("kind","grant").put("id","grant-a")).getJSONObject("state").getString("status"))
      val forgedClosure=JSONObject(batch.toString())
      val badProof=forgedClosure.getJSONArray("mutations").getJSONObject(0).getJSONObject("newState")
      val closureCapability=JSONObject(originalProof.toString());closureCapability.remove("signature")
      badProof.put("signature",sign(coordinator,closureCapability))
      val badProvenance=badProof.getJSONObject("provenance");val badJournal=badProvenance.getJSONObject("originalJournal");val badPayload=badJournal.getJSONObject("payload")
      badPayload.getJSONArray("events").getJSONObject(1).getJSONObject("data").getJSONObject("state").put("signature",badProof.getString("signature"))
      badPayload.getJSONArray("mutations").getJSONObject(1).getJSONObject("newState").put("signature",badProof.getString("signature"))
      badJournal.put("payloadHash",JournalDatabase.hash(badPayload));val badUnsigned=JSONObject(badJournal.toString());badUnsigned.remove("signature");badJournal.put("signature",sign(recipient,badUnsigned))
      badProvenance.put("payloadHash",badJournal.getString("payloadHash")).put("signature",badJournal.getString("signature"))
      val badCommand=forgedClosure.getJSONObject("command");badCommand.getJSONObject("payload").put("sourceHash",badJournal.getString("payloadHash"));badCommand.put("payloadHash",JournalDatabase.hash(badCommand.getJSONObject("payload")))
      assertEquals("GRANT_RETURN_SIGNATURE_INVALID",assertThrows(IllegalArgumentException::class.java){db.commit(forgedClosure)}.message)
      assertEquals(0,db.journalCount())
      assertEquals("accepted",db.commit(batch).getJSONObject("result").getString("status"))
      val stored=db.readSnapshot(JSONObject(scope.toString()).put("kind","grant-return").put("id","grant-a")).getJSONObject("state")
      assertEquals(originalProof.getString("signature"),stored.getString("signature"));assertEquals("returned",db.readSnapshot(JSONObject(scope.toString()).put("kind","grant").put("id","grant-a")).getJSONObject("state").getString("status"))
    }
    context.deleteDatabase(sourceName);context.deleteDatabase(name)
  }

  @Test fun observationBehindOneHundredIntentsStillAttemptsVenueDelivery() {
    context.deleteDatabase("mekoniq-journal.db")
    val profile=android.os.Bundle().apply {putString("organizationId","org-a");putString("venueId","venue-a");putString("deviceId","device-a")}
    org.robolectric.Shadows.shadowOf(context.getSystemService(Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager).setApplicationRestrictions(profile)
    JournalDatabase(context,signer=signer,deviceEpochProvider={"epoch-a"}).use {db->
      db.provisionForTest()
      for(index in 0 until 100)db.recordIntent(testBatch("pending-$index",0).getJSONObject("command"))
      val capture=testBatch("capture-after-one-hundred-intents",0);capture.getJSONObject("command").put("type","Continuity.CaptureTicket");capture.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("kind","isolated-ticket")
      db.commit(capture)
      val selected=db.pendingVenueObservations();assertEquals(1,selected.size);assertEquals("capture-after-one-hundred-intents",selected.single().getString("operationId"))
    }
    // With no owner endpoint, reaching transport is observable; silently returning zero is starvation.
    assertEquals("OWNER_NOT_PROVISIONED",assertThrows(IllegalStateException::class.java){io.mekoniq.tablet.lan.NativePeerTransport(context).flushSettlementObservations()}.message)
    context.deleteDatabase("mekoniq-journal.db")
  }
  @Test fun terminalVenueReceiptAcknowledgesIntentOnlyAtVenueLevel() {
    JournalDatabase.testDatabase(context,signer).use {db->
      val command=testBatch("intent-lifecycle",0).getJSONObject("command");db.recordIntent(command)
      val unknown=JSONObject().put("operationId","intent-lifecycle").put("status","unknown").put("ack","none").put("value",JSONObject()).put("duplicate",false)
      db.recordVenueReceipt(command,unknown)
      fun flag(column:String):Int=db.readableDatabase.rawQuery("SELECT $column FROM outbox WHERE kind='journal'",null).use {it.moveToFirst();it.getInt(0)}
      assertEquals(0,flag("venue_ack"))
      val accepted=JSONObject(unknown.toString()).put("status","accepted").put("ack","venue")
      db.recordVenueReceipt(command,accepted)
      assertEquals(1,flag("venue_ack"));assertEquals(0,flag("cloud_ack"))
      assertEquals("confirmed",db.effects(scope,"command.intent").getJSONObject(0).getString("status"))
    }
  }

  @Test fun safetyTransitionRechecksAllActiveDevicesAfterPreparation() {
    JournalDatabase.testDatabase(context,signer).use {db->
      seed(db,"maintenance","current",JSONObject().put("status","prepared"))
      seed(db,"device","peer",JSONObject().put("status","active").put("deviceEpoch","peer-new"))
      fun enter(id:String):JSONObject {
        val batch=testBatch(id,1);batch.getJSONObject("command").put("type","Maintenance.Enter").put("payload",JSONObject().put("mode","full_shutdown"));batch.getJSONObject("command").put("payloadHash",JournalDatabase.hash(batch.getJSONObject("command").getJSONObject("payload")))
        batch.getJSONArray("mutations").getJSONObject(0).put("ref",JSONObject(scope.toString()).put("kind","maintenance").put("id","current")).put("newState",JSONObject().put("status","active"))
        return batch
      }
      assertThrows(io.mekoniq.tablet.storage.VersionConflict::class.java){db.commit(enter("missing-device-after-prepare"))}
      val checkpoint=JSONObject().put("status","complete").put("deviceEpoch","peer-old").put("pendingCount",0).put("receivedCursor","0").put("appliedCursor","0").put("coveredSequence","0").put("expiresAtMs",System.currentTimeMillis()+30000)
      seed(db,"device-checkpoint","peer",checkpoint)
      assertThrows(io.mekoniq.tablet.storage.VersionConflict::class.java){db.commit(enter("epoch-changed-after-prepare"))}
      checkpoint.put("deviceEpoch","peer-new").put("expiresAtMs",0);seed(db,"device-checkpoint","peer",checkpoint)
      assertThrows(io.mekoniq.tablet.storage.VersionConflict::class.java){db.commit(enter("expired-after-prepare"))}
      checkpoint.put("expiresAtMs",System.currentTimeMillis()+30000);seed(db,"device-checkpoint","peer",checkpoint)
      assertEquals("accepted",db.commit(enter("fresh-complete-inventory")).getJSONObject("result").getString("status"))
    }
  }

}
