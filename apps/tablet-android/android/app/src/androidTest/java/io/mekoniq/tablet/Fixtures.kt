package io.mekoniq.tablet

import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import org.json.JSONArray

fun testBatch(operationId: String, expectedVersion: Int, note: String = "A"): JSONObject {
  val ref = JSONObject().put("organizationId","org-a").put("venueId","venue-a").put("kind","note").put("id","note-1")
  val payload = JSONObject().put("note",note)
  val command = JSONObject().put("schemaVersion",1).put("organizationId","org-a").put("venueId","venue-a").put("operationId",operationId).put("type","Journal.RecordNote").put("actorRef","cashier").put("deviceId","device-a").put("deviceEpoch","epoch-a").put("coordinatorEpoch",1).put("policyRevision",1).put("occurredAt","2026-10-30T00:00:00Z").put("recordedAt","2026-10-30T00:00:00Z").put("payload",payload).put("payloadHash",JournalDatabase.hash(payload))
  return JSONObject().put("command",command).put("expectedAuthority",JSONObject().put("coordinatorEpoch",1).put("policyRevision",1))
    .put("mutations",JSONArray().put(JSONObject().put("ref",ref).put("expectedVersion",expectedVersion).put("newState",payload)))
    .put("events",JSONArray().put(JSONObject().put("type","NoteRecorded").put("data",payload)))
    .put("effects",JSONArray()).put("result",JSONObject().put("status","accepted").put("operationId",operationId).put("value",JSONObject()).put("duplicate",false).put("ack","venue"))
}
