package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import io.mekoniq.tablet.storage.JournalDatabase
import org.junit.Assert.*
import org.junit.Test

/** Native crash/reopen invariant; full O01-O22 reports additionally require the lab/device evidence. */
class ContinuityAcceptanceTest {
  @Test fun committedReceiptRemainsStableAfterNativeReopen() {
    val context=InstrumentationRegistry.getInstrumentation().targetContext
    val name="continuity-"+java.util.UUID.randomUUID()+".db"
    JournalDatabase(context,name).use {it.provisionForTest();it.commit(testBatch("continuity-reopen",0))}
    JournalDatabase(context,name).use {assertTrue(it.commit(testBatch("continuity-reopen",0)).getBoolean("duplicate"));assertEquals(1,it.journalCount())}
    context.deleteDatabase(name)
  }
}
