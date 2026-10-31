package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import io.mekoniq.tablet.identity.DeviceKeys
import io.mekoniq.tablet.storage.JournalDatabase
import io.mekoniq.tablet.lan.NativePeerTransport
import android.content.Context
import android.content.RestrictionsManager
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class LifecycleAcceptanceTest {
  @Test fun stoppedCoordinatorDoesNotAcknowledgePeerOrders() {
    val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
    require(InstrumentationRegistry.getArguments().getString("coordinatorStopped")=="true") {"HOST_MUST_STOP_ENROLLED_COORDINATOR"}
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    require(!config.getBoolean("coordinatorEnabled",false)) {"RUN_ON_ENROLLED_PEER"}
    val org=config.getString("organizationId") ?: error("TEST_DEVICE_NOT_PROVISIONED")
    val venue=config.getString("venueId") ?: error("TEST_DEVICE_NOT_PROVISIONED")
    require(InstrumentationRegistry.getArguments().getString("testVenue")==venue) {"WRONG_TEST_VENUE"}
    val operation="lifecycle-"+java.util.UUID.randomUUID();val payload=JSONObject().put("sessionId","test-not-yet-open").put("tableId","table-1").put("menuVersion",1).put("items",JSONArray().put(JSONObject().put("itemId","rice").put("quantity","1")))
    val actor=JSONObject(context.getSharedPreferences("device-identity",0).getString("offlineGrant",null) ?: error("TEST_GRANT_REQUIRED")).getJSONObject("payload").getString("actorRef")
    val command=JSONObject().put("schemaVersion",1).put("organizationId",org).put("venueId",venue).put("operationId",operation).put("type","Order.Place").put("actorRef",actor).put("deviceId",config.getString("deviceId")).put("deviceEpoch",DeviceKeys(context).deviceEpoch()).put("coordinatorEpoch",config.getInt("coordinatorEpoch",1)).put("policyRevision",config.getInt("policyRevision",1)).put("occurredAt",java.time.Instant.now().toString()).put("recordedAt",java.time.Instant.now().toString()).put("payload",payload).put("payloadHash",JournalDatabase.hash(payload))
    val result=NativePeerTransport(context).send(command)
    assertEquals("pending",result.getString("status"));assertEquals("local",result.getString("ack"))
    JournalDatabase(context).use {db ->
      val persisted=db.receipt(JSONObject().put("organizationId",org).put("venueId",venue),operation,command.getString("payloadHash"),command)
      assertNotNull(persisted);assertEquals("pending",persisted!!.getString("status"))
      assertTrue(db.pendingOutbox().toString().contains(operation))
    }
  }
}
