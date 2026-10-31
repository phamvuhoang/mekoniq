package io.mekoniq.tablet

import android.content.Context
import android.database.sqlite.SQLiteFullException
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.SQLiteMode
import io.mekoniq.tablet.storage.JournalDatabase
import io.mekoniq.tablet.storage.VersionConflict

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@SQLiteMode(SQLiteMode.Mode.NATIVE)
class NativeStoreTest {
  private val context:Context get()=RuntimeEnvironment.getApplication()
  private val signer:(ByteArray)->ByteArray = { java.security.MessageDigest.getInstance("SHA-256").digest(it) }
  @Test fun scopeReadDetectsNewResourcesInsertedAfterRecoveryInventory() {
    JournalDatabase.testDatabase(context,signer).use { db ->
      val scope=org.json.JSONObject().put("organizationId","org-a").put("venueId","venue-a")
      val before=db.snapshots(scope)
      db.commit(testBatch("concurrent",0))
      val stale=testBatch("stale-recovery",1)
      stale.put("expectedReads",org.json.JSONArray().apply { for(i in 0 until before.length()){val read=before.getJSONObject(i);put(org.json.JSONObject().put("ref",read.getJSONObject("ref")).put("expectedVersion",read.getInt("version")))} })
      assertThrows(VersionConflict::class.java) {db.commit(stale)}
      assertEquals(1,db.journalCount())
    }
  }
  @Test fun samePayloadCannotChangeCommandTypeOrActorOnRetry() {
    JournalDatabase.testDatabase(context,signer).use { db ->
      db.commit(testBatch("once",0))
      val changed=testBatch("once",0);changed.getJSONObject("command").put("type","Payment.RecordCash")
      assertThrows(IllegalStateException::class.java) {db.commit(changed)}
      assertEquals(1,db.journalCount())
    }
  }
  @Test fun oldCoordinatorCannotWriteSharedStateUsingReplacementEpoch() {
    JournalDatabase.testDatabase(context,signer).use {db ->
      db.commit(testBatch("before-handoff",0))
      db.writableDatabase.execSQL("UPDATE authority SET coordinator_epoch=2,owner_device_id='replacement',owner_device_epoch='replacement-epoch'")
      val stale=testBatch("after-handoff",1);stale.getJSONObject("command").put("coordinatorEpoch",2);stale.getJSONObject("expectedAuthority").put("coordinatorEpoch",2)
      val rejected=assertThrows(IllegalStateException::class.java){db.commit(stale)}
      assertEquals("COORDINATOR_FENCED",rejected.message)
      assertEquals(1,db.journalCount())
      stale.getJSONObject("command").put("type","Continuity.CaptureTicket")
      assertThrows(IllegalArgumentException::class.java){db.commit(stale)}
    }
  }
  @Test fun venueBusinessDateUsesAppliedIanaTimezone() {
    JournalDatabase.testDatabase(context,signer).use {db ->
      db.writableDatabase.execSQL("INSERT INTO aggregate_snapshot VALUES('org-a','venue-a','venue-layout','current',1,?)",arrayOf("{\"timezone\":\"Asia/Ho_Chi_Minh\"}"))
      val batch=testBatch("timezone",0);batch.getJSONObject("command").put("occurredAt","2026-10-29T18:30:00Z")
      db.commit(batch)
      val entry=db.exportRows().getJSONObject(0).getJSONObject("entry")
      assertEquals("2026-10-30",entry.getString("businessDate"));assertEquals("Asia/Ho_Chi_Minh",entry.getString("timezone"))
    }
  }
  @Test fun localCaptureCannotDispatchLiveEffectsOrForgeDeviceCheckpoint() {
    JournalDatabase.testDatabase(context,signer).use {db ->
      val capture=testBatch("capture-effects",0);capture.getJSONObject("command").put("type","Continuity.CaptureTicket")
      capture.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("kind","isolated-ticket")
      capture.getJSONArray("effects").put(org.json.JSONObject().put("id","unsafe").put("type","robot.execute").put("payload",org.json.JSONObject()))
      assertEquals("LOCAL_EVIDENCE_EFFECT_FORBIDDEN",assertThrows(IllegalArgumentException::class.java){db.commit(capture)}.message)
      val checkpoint=testBatch("forged-checkpoint",0);checkpoint.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("kind","device-checkpoint")
      assertEquals("RESERVED_AGGREGATE_KIND",assertThrows(IllegalArgumentException::class.java){db.commit(checkpoint)}.message)
      db.writableDatabase.execSQL("UPDATE authority SET fenced=1")
      val bypass=testBatch("fence-bypass",0);bypass.getJSONObject("command").put("type","Ownership.Fence")
      assertEquals("HANDOFF_COMPLETION_MUTATION_FORBIDDEN",assertThrows(IllegalArgumentException::class.java){db.commit(bypass)}.message)
      assertEquals(0,db.journalCount())
    }
  }
  @Test fun staleBatchDoesNotPartiallyWrite() {
    JournalDatabase.testDatabase(context,signer).use {
      it.commit(testBatch("first",0))
      assertThrows(VersionConflict::class.java) { it.commit(testBatch("stale",0)) }
      assertEquals(1,it.journalCount());assertEquals(1,it.outboxCount())
    }
  }
  @Test fun reopenReturnsOriginalReceiptAndNeverReusesSequence() {
    val name="reopen-${java.util.UUID.randomUUID()}.db"
    JournalDatabase(context,name,signer).use { it.provisionForTest();assertEquals("1",it.commit(testBatch("first",0)).getString("sequence")) }
    JournalDatabase(context,name,signer).use {
      assertTrue(it.commit(testBatch("first",0)).getBoolean("duplicate"))
      assertEquals("2",it.commit(testBatch("second",1)).getString("sequence"))
      assertThrows(IllegalStateException::class.java) { it.commit(testBatch("first",0,"changed")) }
      assertEquals(2,it.journalCount())
    }
    context.deleteDatabase(name)
  }
  @Test fun signerFailureRollsBackMutationsAndCounter() {
    JournalDatabase.testDatabase(context,{ throw IllegalStateException("SIGNING_FAILED") }).use {
      assertThrows(IllegalStateException::class.java) { it.commit(testBatch("bad",0)) }
      assertEquals(0,it.journalCount());assertEquals(0,it.outboxCount())
      assertEquals(0,it.readSnapshot(testBatch("bad",0).getJSONArray("mutations").getJSONObject(0).getJSONObject("ref")).getInt("version"))
    }
  }
  @Test fun fullDiskDoesNotReturnReceiptOrPartiallyCommit() {
    JournalDatabase.testDatabase(context,signer).use {
      val db=it.writableDatabase
      val pages=db.rawQuery("PRAGMA page_count",null).use { c->c.moveToFirst();c.getInt(0) }
      db.beginTransaction()
      try {
        db.rawQuery("PRAGMA max_page_count=$pages",null).use { c->c.moveToFirst() }
        assertThrows(SQLiteFullException::class.java) { it.commit(testBatch("full",0,"x".repeat(64000))) }
      } finally { runCatching { db.endTransaction() } }
      assertEquals(0,it.journalCount());assertEquals(0,it.outboxCount())
    }
  }
  @Test fun unprovisionedStoreCannotAcceptClientAuthority() {
    JournalDatabase(context,"unprovisioned-${java.util.UUID.randomUUID()}.db",signer).use {
      assertThrows(IllegalStateException::class.java) { it.commit(testBatch("bad",0)) }
      assertEquals(0,it.journalCount())
    }
  }
  @Test fun fractionalVersionAndCrossScopeAreRejectedBeforeMutation() {
    JournalDatabase.testDatabase(context,signer).use {
      val fractional=testBatch("fractional",0)
      fractional.getJSONArray("mutations").getJSONObject(0).put("expectedVersion",0.5)
      assertThrows(IllegalArgumentException::class.java) { it.commit(fractional) }
      val foreign=testBatch("foreign",0)
      foreign.getJSONArray("mutations").getJSONObject(0).getJSONObject("ref").put("venueId","venue-b")
      assertThrows(IllegalArgumentException::class.java) { it.commit(foreign) }
      assertEquals(0,it.journalCount())
    }
  }
  @Test fun ackRequiresMatchingScopeHashAndProducer() {
    JournalDatabase.testDatabase(context,signer).use {
      it.commit(testBatch("first",0))
      val entry=it.exportRows().getJSONObject(0).getJSONObject("entry")
      val receipt=org.json.JSONObject(entry.toString()).put("ack","cloud").put("committed",true)
      receipt.put("payloadHash","wrong")
      assertThrows(IllegalArgumentException::class.java) { it.ack(receipt) }
      assertEquals(1,it.pendingOutbox().length())
      receipt.put("payloadHash",entry.getString("payloadHash"));it.ack(receipt)
      assertEquals(0,it.pendingOutbox().length())
    }
  }
}
