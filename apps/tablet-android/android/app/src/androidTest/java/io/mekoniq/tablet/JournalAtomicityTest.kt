package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import io.mekoniq.tablet.storage.JournalDatabase
import io.mekoniq.tablet.storage.VersionConflict
import org.junit.Assert.*
import org.junit.Test

class JournalAtomicityTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
  @Test fun staleBatchDoesNotPartiallyWrite() {
    val db = JournalDatabase.testDatabase(context)
    db.use {
      db.commit(testBatch("op-1", 0))
      assertThrows(VersionConflict::class.java) { db.commit(testBatch("op-2", 0)) }
      assertEquals(1, db.journalCount())
      assertEquals(1, db.outboxCount())
    }
  }
  @Test fun duplicateAfterReopenDoesNotAllocateAnotherSequence() {
    val name = "atomicity-${java.util.UUID.randomUUID()}.db"
    JournalDatabase(context, name).use { it.provisionForTest(); it.commit(testBatch("op-1", 0)) }
    JournalDatabase(context, name).use {
      assertTrue(it.commit(testBatch("op-1", 0)).getBoolean("duplicate"))
      assertEquals(1, it.journalCount())
      assertThrows(IllegalStateException::class.java) { it.commit(testBatch("op-1", 0, "changed")) }
    }
    context.deleteDatabase(name)
  }
  @Test fun signingFailureRollsBackEntireTransaction() {
    val db = JournalDatabase.testDatabase(context, signer = { throw IllegalStateException("SIGN_FAILED") })
    db.use {
      assertThrows(IllegalStateException::class.java) { db.commit(testBatch("op-1", 0)) }
      assertEquals(0, db.journalCount()); assertEquals(0, db.outboxCount())
    }
  }
}
