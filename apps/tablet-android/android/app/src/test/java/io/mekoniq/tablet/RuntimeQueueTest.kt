package io.mekoniq.tablet

import io.mekoniq.tablet.lan.RuntimeQueue
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class RuntimeQueueTest {
  @Test fun liveListenerCannotHideSuspendedDomain() {
    RuntimeQueue.serviceUp=true;RuntimeQueue.resumeRuntime()
    RuntimeQueue.heartbeat(true)
    assertTrue(RuntimeQueue.ready())
    RuntimeQueue.suspendRuntime()
    assertFalse(RuntimeQueue.ready())
    assertEquals("unknown",RuntimeQueue.submit(org.json.JSONObject().put("operationId","op-1")).getString("status"))
  }
  @Test fun expiredHeartbeatAndUnwritableStoreRejectAcknowledgement() {
    RuntimeQueue.serviceUp=true;RuntimeQueue.resumeRuntime();RuntimeQueue.heartbeat(true)
    ShadowSystemClock.advanceBy(Duration.ofSeconds(3))
    assertFalse(RuntimeQueue.ready())
    RuntimeQueue.heartbeat(false);assertFalse(RuntimeQueue.ready())
  }
}
