package io.mekoniq.tablet

import androidx.test.core.app.ActivityScenario
import androidx.lifecycle.Lifecycle
import io.mekoniq.tablet.lan.RuntimeQueue
import org.junit.Assert.*
import org.junit.Test

class RuntimeLifecycleTest {
 @Test fun backgroundActivityCannotBeRevivedByJavascriptHeartbeat() {
  ActivityScenario.launch(MainActivity::class.java).use {scenario ->
   try {
    RuntimeQueue.serviceUp=true;RuntimeQueue.heartbeat(true);assertTrue(RuntimeQueue.ready())
    scenario.moveToState(Lifecycle.State.CREATED)
    RuntimeQueue.heartbeat(true)
    assertFalse(RuntimeQueue.ready())
   } finally {RuntimeQueue.serviceUp=false;RuntimeQueue.suspendRuntime()}
  }
 }
}
