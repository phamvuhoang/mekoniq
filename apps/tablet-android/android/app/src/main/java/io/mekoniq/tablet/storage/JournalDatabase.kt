package io.mekoniq.tablet.storage

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.database.sqlite.SQLiteFullException
import android.os.Bundle
import android.content.RestrictionsManager
import io.mekoniq.tablet.BuildConfig
import io.mekoniq.tablet.identity.DeviceKeys
import org.erdtman.jcs.JsonCanonicalizer
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigInteger
import java.security.MessageDigest
import java.util.UUID

class VersionConflict : IllegalStateException("VERSION_CONFLICT")
class JournalDatabase(
  private val context: Context,
  name: String = "mekoniq-journal.db",
  private val signer: (ByteArray) -> ByteArray = { DeviceKeys(context).sign(it) },
  private val deviceEpochProvider: () -> String = {DeviceKeys(context).deviceEpoch()},
  private val publicJwkProvider: () -> String = {DeviceKeys(context).publicJwk()}
) : SQLiteOpenHelper(context, name, null, 3), AutoCloseable {
  init {setWriteAheadLoggingEnabled(true)}
  override fun onConfigure(db: SQLiteDatabase) { db.setForeignKeyConstraintsEnabled(true); db.execSQL("PRAGMA synchronous=FULL") }
  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL("CREATE TABLE authority(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,coordinator_epoch INTEGER NOT NULL,policy_revision INTEGER NOT NULL,snapshot_revision INTEGER NOT NULL DEFAULT 0,fenced INTEGER NOT NULL DEFAULT 0,owner_device_id TEXT NOT NULL,owner_device_epoch TEXT NOT NULL,public_jwk TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id))")
    db.execSQL("CREATE TABLE aggregate_snapshot(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,state_json TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,kind,id))")
    db.execSQL("CREATE TABLE operation_receipt(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,result_json TEXT NOT NULL,sequence TEXT NOT NULL,command_fingerprint TEXT NOT NULL,PRIMARY KEY(organization_id,venue_id,operation_id))")
    db.execSQL("CREATE TABLE producer_counter(device_id TEXT NOT NULL,device_epoch TEXT NOT NULL,sequence TEXT NOT NULL,PRIMARY KEY(device_id,device_epoch))")
    db.execSQL("CREATE TABLE journal(entry_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,device_id TEXT NOT NULL,device_epoch TEXT NOT NULL,producer_sequence TEXT NOT NULL,operation_id TEXT NOT NULL,payload_hash TEXT NOT NULL,entry_json TEXT NOT NULL,signature TEXT NOT NULL,UNIQUE(device_id,device_epoch,producer_sequence))")
    db.execSQL("CREATE TABLE cloud_ack_receipt(hash TEXT PRIMARY KEY)")
    db.execSQL("CREATE TABLE sync_status(id INTEGER PRIMARY KEY CHECK(id=1),last_sync_at TEXT NOT NULL)")
    db.execSQL("CREATE TABLE native_fence(handoff_id TEXT PRIMARY KEY,proof_json TEXT NOT NULL)")
    db.execSQL("CREATE TABLE audit(entry_id TEXT PRIMARY KEY,actor_ref TEXT NOT NULL,event_json TEXT NOT NULL)")
    db.execSQL("CREATE TABLE domain_event(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,id TEXT PRIMARY KEY,type TEXT NOT NULL,data_json TEXT NOT NULL)")
    db.execSQL("CREATE TABLE outbox(id TEXT PRIMARY KEY,journal_entry_id TEXT NOT NULL REFERENCES journal(entry_id),kind TEXT NOT NULL,payload_json TEXT NOT NULL,cloud_ack INTEGER NOT NULL DEFAULT 0,venue_ack INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,payload_format TEXT NOT NULL DEFAULT 'legacy',venue_observation INTEGER NOT NULL DEFAULT -1 CHECK(venue_observation IN(-1,0,1)))")
    createOutboxIndexes(db)
    db.execSQL("CREATE TABLE local_dirty(kind TEXT NOT NULL,id TEXT NOT NULL,operation_id TEXT NOT NULL,PRIMARY KEY(kind,id))")
    db.execSQL("CREATE TABLE projection_cursor(organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,coordinator_epoch INTEGER NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(organization_id,venue_id))")
    db.execSQL("CREATE TABLE inbox(id TEXT PRIMARY KEY,raw_json TEXT NOT NULL)")
    db.execSQL("CREATE TABLE sync_cursor(producer TEXT PRIMARY KEY,received_cursor TEXT NOT NULL,applied_cursor TEXT NOT NULL)")
    db.execSQL("CREATE TABLE quarantine(id TEXT PRIMARY KEY,reason TEXT NOT NULL,raw_json TEXT NOT NULL)")
  }
  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
    require(oldVersion in 1..2 && newVersion==3) {"UNSUPPORTED_SCHEMA_UPGRADE"}
    if(oldVersion<2)db.execSQL("ALTER TABLE outbox ADD COLUMN payload_format TEXT NOT NULL DEFAULT 'legacy'")
    db.execSQL("ALTER TABLE outbox ADD COLUMN venue_observation INTEGER NOT NULL DEFAULT -1 CHECK(venue_observation IN(-1,0,1))")
    createOutboxIndexes(db)
  }
  override fun onOpen(db:SQLiteDatabase) {
    super.onOpen(db)
    // The marker also handles v1 archive rows restored into the current table schema.
    val rows=db.rawQuery("SELECT o.id,o.kind,o.payload_json,j.entry_json FROM outbox o JOIN journal j ON j.entry_id=o.journal_entry_id WHERE o.payload_format='legacy' OR (o.kind='journal' AND o.venue_observation=-1)",null).use {c->mutableListOf<Array<String>>().apply {while(c.moveToNext())add(arrayOf(c.getString(0),c.getString(1),c.getString(2),c.getString(3)))}}
    if(rows.isEmpty())return
    db.beginTransaction()
    try {
      for(row in rows) {
        val raw=JSONObject(row[2]);var payload=raw
        if(row[1]!="journal") {
          val effects=JSONObject(row[3]).getJSONObject("payload").optJSONArray("effects") ?: JSONArray()
          val signedEffect=(0 until effects.length()).map {effects.getJSONObject(it)}.firstOrNull {it.optString("id")==row[0]&&it.optString("type")==row[1]}
          val wrapped=raw.keys().asSequence().toSet()==setOf("id","type","payload")&&raw.optString("id")==row[0]&&raw.optString("type")==row[1]&&raw.optJSONObject("payload")!=null
          if(signedEffect!=null&&canonical(raw).contentEquals(canonical(signedEffect.getJSONObject("payload"))))payload=raw
          else if(wrapped) {
            require(signedEffect==null||canonical(raw).contentEquals(canonical(signedEffect))) {"LEGACY_EFFECT_METADATA_CONFLICT"}
            payload=raw.getJSONObject("payload")
          }
        }
        val entry=JSONObject(row[3])
        db.execSQL("UPDATE outbox SET payload_json=?,payload_format='inner',venue_observation=? WHERE id=?",arrayOf(payload.toString(),if(row[1]=="journal")venueObservation(entry) else 0,row[0]))
        if(row[1]=="journal"&&entry.optString("kind")=="intent") {
          val terminal=db.rawQuery("SELECT r.result_json FROM operation_receipt r JOIN outbox i ON i.journal_entry_id=? AND i.kind='command.intent' AND i.status='confirmed' WHERE r.organization_id=? AND r.venue_id=? AND r.operation_id=?",arrayOf(row[0],entry.getString("organizationId"),entry.getString("venueId"),entry.getString("operationId"))).use {it.moveToFirst()&&JSONObject(it.getString(0)).getString("status") in setOf("accepted","rejected")}
          if(terminal)db.execSQL("UPDATE outbox SET venue_ack=1 WHERE id=?",arrayOf(row[0]))
        }
      }
      db.setTransactionSuccessful()
    }finally{db.endTransaction()}
  }
  private fun createOutboxIndexes(db:SQLiteDatabase) {
    db.execSQL("CREATE INDEX IF NOT EXISTS outbox_payload_encoding ON outbox(payload_format)")
    db.execSQL("CREATE INDEX IF NOT EXISTS outbox_venue_observations ON outbox(kind,venue_observation,venue_ack)")
  }
  private fun venueObservation(entry:JSONObject):Int = if(entry.optString("kind")=="observation"&&entry.getJSONObject("payload").optString("operationType") in setOf("SettlementGrant.Use","SettlementGrant.Return","Continuity.CaptureTicket","Continuity.RecordPaymentObservation"))1 else 0
  fun provisionForTest() {
    check(BuildConfig.DEBUG) { "TEST_PROVISIONING_FORBIDDEN" }
    val key=runCatching {DeviceKeys(context)}.getOrNull()
    writableDatabase.execSQL("INSERT OR IGNORE INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,public_jwk) VALUES('org-a','venue-a',1,1,?,?,?)",arrayOf("device-a",runCatching {deviceEpochProvider()}.getOrElse {"epoch-a"},key?.publicJwk() ?: "{}"))
  }
  fun provisionSigned(grant: JSONObject, signature: String) {
    val manager = context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
    val trustedIssuer = manager.applicationRestrictions.getString("enrollmentIssuerJwk") ?: error("ISSUER_NOT_PROVISIONED")
    require(DeviceKeys.verify(trustedIssuer, canonical(grant), DeviceKeys.decode(signature))) { "INVALID_GRANT_SIGNATURE" }
    require(grant.getString("deviceEpoch") == deviceEpochProvider()) { "WRONG_DEVICE" }
    require(java.time.Instant.parse(grant.getString("expiresAt")).isAfter(java.time.Instant.now())) { "GRANT_EXPIRED" }
    val org = id(grant.getString("organizationId")); val venue = id(grant.getString("venueId"))
    val config=manager.applicationRestrictions
    require(config.getString("organizationId")==org && config.getString("venueId")==venue) { "PROVISION_SCOPE_MISMATCH" }
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.rawQuery("SELECT coordinator_epoch,policy_revision,owner_device_id,public_jwk FROM authority WHERE organization_id=? AND venue_id=?", arrayOf(org,venue)).use { cursor ->
        if (cursor.moveToFirst()) {
          val previous=cursor.getInt(0);val next=grant.getInt("coordinatorEpoch")
          require(grant.getInt("policyRevision")>=cursor.getInt(1)) { "STALE_AUTHORITY" }
          if(next!=previous) {
            require(next==previous+1 && grant.optInt("previousCoordinatorEpoch",-1)==previous) {"HANDOFF_REQUIRED"}
            val proofs=grant.getJSONArray("fencingProofs");var verified=false
            for(index in 0 until proofs.length()) {
              val proof=proofs.getJSONObject(index)
              if(proof.getString("resourceId")!="coordinator")continue
              val unsigned=JSONObject(proof.toString());val proofSignature=unsigned.getString("signature");unsigned.remove("signature")
              require(proof.getString("organizationId")==org&&proof.getString("venueId")==venue&&proof.getString("handoffId")==grant.getString("handoffId")&&proof.getString("status")=="fenced"&&proof.getString("newOwnerDeviceId")==grant.getString("ownerDeviceId")&&proof.getString("oldOwnerDeviceId")==cursor.getString(2)&&proof.getInt("oldEpoch")==previous&&proof.getInt("newEpoch")==next) {"FENCING_PROOF_MISMATCH"}
              require(DeviceKeys.verify(cursor.getString(3),canonical(unsigned),DeviceKeys.decode(proofSignature))) {"FENCING_SIGNATURE_INVALID"};verified=true
            }
            require(verified) {"FENCING_REQUIRED"}
            db.execSQL("UPDATE authority SET coordinator_epoch=?,owner_device_id=?,owner_device_epoch=?,public_jwk=?,fenced=? WHERE organization_id=? AND venue_id=?",arrayOf<Any>(next,grant.getString("ownerDeviceId"),grant.getString("ownerDeviceEpoch"),grant.getJSONObject("publicJwk").toString(),if(grant.getString("ownerDeviceId")==config.getString("deviceId"))0 else 1,org,venue))
          }
        }
      }
      db.execSQL("INSERT OR IGNORE INTO authority(organization_id,venue_id,coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,public_jwk) VALUES(?,?,?,?,?,?,?)", arrayOf<Any>(org,venue,grant.getInt("coordinatorEpoch"),grant.getInt("policyRevision"),grant.getString("ownerDeviceId"),grant.getString("ownerDeviceEpoch"),grant.getJSONObject("publicJwk").toString()))
      db.execSQL("UPDATE authority SET policy_revision=? WHERE organization_id=? AND venue_id=?",arrayOf(grant.getInt("policyRevision"),org,venue))
      if(grant.getInt("coordinatorEpoch")>1)installHandoffSnapshots(db,grant,org,venue)
      val ownerState=JSONObject().put("id",grant.getString("ownerDeviceId")).put("deviceEpoch",grant.getString("ownerDeviceEpoch")).put("publicJwk",grant.getJSONObject("publicJwk")).put("status","active")
      val ownerRef=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device").put("id",grant.getString("ownerDeviceId"));val oldOwner=readSnapshot(ownerRef)
      val mergedOwner=JSONObject(oldOwner.getJSONObject("state").toString());for(key in ownerState.keys())mergedOwner.put(key,ownerState.get(key))
      db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,"device",grant.getString("ownerDeviceId"),oldOwner.getInt("version")+if(canonical(mergedOwner).contentEquals(canonical(oldOwner.getJSONObject("state"))))0 else 1,mergedOwner.toString()))
      val state=JSONObject().put("id",config.getString("deviceId")).put("deviceEpoch",deviceEpochProvider()).put("publicJwk",JSONObject(publicJwkProvider())).put("status","active")
      val deviceId=id(config.getString("deviceId") ?: error("IDENTITY_NOT_PROVISIONED"))
      val selfRef=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device").put("id",deviceId);val oldSelf=readSnapshot(selfRef)
      val mergedSelf=JSONObject(oldSelf.getJSONObject("state").toString());for(key in state.keys())mergedSelf.put(key,state.get(key))
      db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,"device",deviceId,oldSelf.getInt("version")+if(canonical(mergedSelf).contentEquals(canonical(oldSelf.getJSONObject("state"))))0 else 1,mergedSelf.toString()))
      db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  private fun installHandoffSnapshots(db:SQLiteDatabase,grant:JSONObject,org:String,venue:String) {
    require(grant.toString().toByteArray().size<=4194304) {"HANDOFF_PACKAGE_TOO_LARGE"}
    require(grant.optBoolean("handoffReceiptsComplete",false)) {"HANDOFF_RECEIPT_CHECKPOINT_REQUIRED"}
    val snapshots=grant.optJSONArray("handoffSnapshots") ?: error("HANDOFF_STATE_REQUIRED")
    require(snapshots.length() in 1..10000) {"HANDOFF_STATE_REQUIRED"}
    var activeOwnership=false
    val proofs=grant.getJSONArray("fencingProofs")
    for(index in 0 until snapshots.length()) {
      val snapshot=snapshots.getJSONObject(index);val ref=snapshot.getJSONObject("ref");val state=snapshot.getJSONObject("state")
      require(ref.getString("organizationId")==org&&ref.getString("venueId")==venue) {"HANDOFF_SCOPE_MISMATCH"}
      val kind=ref.getString("kind");val aggregateId=id(ref.getString("id"))
      require(kind!="__scope__") {"HANDOFF_STATE_KIND_FORBIDDEN"}
      if(kind=="device-checkpoint")continue
      if(kind=="ownership") {
        require(aggregateId==venue&&state.getString("status")=="active"&&state.getString("owner")==grant.getString("ownerDeviceId")&&state.getString("deviceEpoch")==grant.getString("ownerDeviceEpoch")&&state.getInt("epoch")==grant.getInt("coordinatorEpoch")&&state.getString("handoffId")==grant.getString("handoffId")&&state.getBoolean("fenced")&&state.getBoolean("cursorComplete")&&state.getBoolean("executorEpochAck")) {"HANDOFF_STATE_MISMATCH"}
        require(state.getJSONArray("proofs").toString()==proofs.toString()) {"HANDOFF_PROOF_MISMATCH"}
        activeOwnership=true
      } else if(kind=="robot") {
        val proof=(0 until proofs.length()).map {proofs.getJSONObject(it)}.firstOrNull {it.getString("resourceId")=="robot:$aggregateId"} ?: error("ROBOT_FENCING_REQUIRED")
        require(state.getString("ownerDeviceId")==grant.getString("ownerDeviceId")&&state.getInt("controlEpoch")==proof.getInt("newEpoch")&&canonical(state.getJSONObject("fencingProof")).contentEquals(canonical(proof))) {"ROBOT_FENCING_MISMATCH"}
      }
      if(kind=="device") {
        require(state.getString("id")==aggregateId&&state.getString("deviceEpoch").isNotBlank()&&state.getString("status") in setOf("active","revoked","inactive")) {"HANDOFF_DEVICE_INVALID"}
        com.nimbusds.jose.jwk.ECKey.parse(state.getJSONObject("publicJwk").toString()).toECPublicKey()
        val previous=readSnapshot(ref);val merged=JSONObject(previous.getJSONObject("state").toString())
        for(key in state.keys())merged.put(key,state.get(key))
        val changed=!canonical(merged).contentEquals(canonical(previous.getJSONObject("state")))
        db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,kind,aggregateId,previous.getInt("version")+if(changed)1 else 0,merged.toString()))
        continue
      }
      integer(snapshot,"version");val existing=readSnapshot(ref)
      require(snapshot.getInt("version")>=existing.getInt("version")) {"STALE_HANDOFF_STATE"}
      if(snapshot.getInt("version")==existing.getInt("version"))require(canonical(state).contentEquals(canonical(existing.getJSONObject("state")))) {"HANDOFF_VERSION_CONFLICT"}
      db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,kind,aggregateId,snapshot.getInt("version"),state.toString()))
    }
    require(activeOwnership) {"ACTIVE_OWNERSHIP_REQUIRED"}
    db.execSQL("DELETE FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='device-checkpoint'",arrayOf(org,venue))
    installHandoffReceipts(db,grant,org,venue)
  }
  private fun installHandoffReceipts(db:SQLiteDatabase,grant:JSONObject,org:String,venue:String) {
    val entries=grant.optJSONArray("handoffEntries") ?: error("HANDOFF_RECEIPT_CHECKPOINT_REQUIRED")
    require(entries.length() in 1..1000) {"HANDOFF_PACKAGE_TOO_LARGE"}
    val inventory=grant.getJSONArray("handoffProducerKeys");require(inventory.length() in 1..1000)
    val keys=mutableMapOf<String,String>()
    for(index in 0 until inventory.length()) {val item=inventory.getJSONObject(index);val identity=item.getString("deviceId")+":"+item.getString("deviceEpoch");require(keys.put(identity,item.getJSONObject("publicJwk").toString())==null) {"DUPLICATE_HANDOFF_KEY"}}
    val operations=mutableSetOf<String>()
    val producerSequences=mutableMapOf<String,java.util.TreeSet<BigInteger>>()
    for(index in 0 until entries.length()) {
      val entry=entries.getJSONObject(index);val device=entry.getString("deviceId");val epoch=entry.getString("deviceEpoch");val sequence=entry.getString("sequence");val entryId=id(entry.getString("entryId"))
      require(entry.getInt("schemaVersion")==1&&entry.getString("organizationId")==org&&entry.getString("venueId")==venue) {"HANDOFF_JOURNAL_SCOPE_MISMATCH"}
      require(Regex("[1-9][0-9]*").matches(sequence)) {"INVALID_SEQUENCE"}
      producerSequences.getOrPut("$device:$epoch"){java.util.TreeSet()}.add(BigInteger(sequence))
      val key=keys["$device:$epoch"] ?: error("HANDOFF_SIGNING_KEY_UNAVAILABLE")
      val unsigned=JSONObject(entry.toString());val signature=unsigned.getString("signature");unsigned.remove("signature")
      require(DeviceKeys.verify(key,canonical(unsigned),DeviceKeys.decode(signature))) {"HANDOFF_JOURNAL_SIGNATURE_INVALID"}
      val payload=entry.getJSONObject("payload");require(entry.getString("payloadHash")==hash(payload)) {"HANDOFF_JOURNAL_HASH_MISMATCH"}
      val command=payload.optJSONObject("commandEnvelope") ?: error("HANDOFF_RECEIPT_METADATA_REQUIRED")
      val result=payload.optJSONObject("commandResult") ?: error("HANDOFF_RECEIPT_METADATA_REQUIRED")
      val operation=command.getString("operationId");operations.add(operation)
      require(command.getString("organizationId")==org&&command.getString("venueId")==venue&&entry.getString("operationId")==operation&&result.getString("operationId")==operation&&payload.getString("commandFingerprint")==commandFingerprint(command)&&command.getString("payloadHash")==hash(command.getJSONObject("payload"))) {"HANDOFF_RECEIPT_MISMATCH"}
      val oldJournal=db.rawQuery("SELECT entry_json FROM journal WHERE entry_id=? OR (device_id=? AND device_epoch=? AND producer_sequence=?)",arrayOf(entryId,device,epoch,sequence)).use {if(it.moveToFirst())it.getString(0) else null}
      if(oldJournal!=null)require(canonical(JSONObject(oldJournal)).contentEquals(canonical(entry))) {"HANDOFF_JOURNAL_CONFLICT"}
      else {
        db.execSQL("INSERT INTO journal VALUES(?,?,?,?,?,?,?,?,?,?)",arrayOf(entryId,org,venue,device,epoch,sequence,operation,entry.getString("payloadHash"),entry.toString(),signature))
        db.execSQL("INSERT INTO outbox(id,journal_entry_id,kind,payload_json,cloud_ack,status,payload_format,venue_observation) VALUES(?,?,?,?,1,'confirmed','inner',?)",arrayOf(entryId,entryId,"journal",entry.toString(),venueObservation(entry)))
        val events=payload.getJSONArray("events")
        for(eventIndex in 0 until events.length()) {val event=events.getJSONObject(eventIndex);db.execSQL("INSERT OR IGNORE INTO domain_event VALUES(?,?,?,?,?)",arrayOf(org,venue,"$entryId:$eventIndex",event.getString("type"),event.getJSONObject("data").toString()))}
      }
      val existing=receipt(JSONObject().put("organizationId",org).put("venueId",venue),operation,command.getString("payloadHash"),command)
      if(existing==null || (existing.getString("status") in setOf("pending","unknown")&&result.getString("status") in setOf("accepted","rejected")))db.execSQL("INSERT OR REPLACE INTO operation_receipt VALUES(?,?,?,?,?,?,?)",arrayOf(org,venue,operation,command.getString("payloadHash"),result.toString(),sequence,commandFingerprint(command)))
      else if(existing.getString("status") in setOf("accepted","rejected")&&result.getString("status") in setOf("accepted","rejected"))require(canonical(JSONObject(existing.toString()).apply {remove("duplicate")}).contentEquals(canonical(JSONObject(result.toString()).apply {remove("duplicate")}))) {"HANDOFF_RECEIPT_CONFLICT"}
      db.execSQL("UPDATE outbox SET cloud_ack=1,status='confirmed' WHERE journal_entry_id=? AND kind='journal'",arrayOf(entryId))
      if(result.getString("status") in setOf("accepted","rejected")) {
        db.execSQL("UPDATE outbox SET status='confirmed' WHERE id=? AND kind='command.intent'",arrayOf("$operation:intent"))
        db.execSQL("DELETE FROM local_dirty WHERE operation_id=?",arrayOf(operation))
      }
      val previous=db.rawQuery("SELECT sequence FROM producer_counter WHERE device_id=? AND device_epoch=?",arrayOf(device,epoch)).use {if(it.moveToFirst())BigInteger(it.getString(0)) else BigInteger.ZERO}
      db.execSQL("INSERT OR REPLACE INTO producer_counter VALUES(?,?,?)",arrayOf(device,epoch,previous.max(BigInteger(sequence)).toString()))
    }
    require(operations.size==grant.getInt("handoffReceiptCount")) {"HANDOFF_RECEIPT_COUNT_MISMATCH"}
    for((producer,sequences) in producerSequences) {
      var expected=BigInteger.ONE
      for(sequence in sequences){require(sequence==expected) {"HANDOFF_PRODUCER_GAP"};expected=expected.add(BigInteger.ONE)}
      val last=expected.subtract(BigInteger.ONE).toString()
      db.execSQL("INSERT OR REPLACE INTO sync_cursor VALUES(?,?,?)",arrayOf(producer,last,last))
    }
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val localPending=db.rawQuery("SELECT COUNT(*) FROM outbox o JOIN journal j ON j.entry_id=o.journal_entry_id WHERE j.device_id=? AND j.device_epoch=? AND ((o.kind='journal' AND o.cloud_ack=0) OR (o.kind<>'journal' AND o.status IN ('pending','dispatching','unknown')))",arrayOf(config.getString("deviceId"),deviceEpochProvider())).use {it.moveToFirst();it.getInt(0)}
    require(localPending==0) {"HANDOFF_LOCAL_CHECKPOINT_INCOMPLETE"}
  }
  fun installSignedPeerDevice(grant:JSONObject,signature:String) {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val issuer=config.getString("enrollmentIssuerJwk") ?: error("ISSUER_NOT_PROVISIONED")
    require(DeviceKeys.verify(issuer,canonical(grant),DeviceKeys.decode(signature))) {"INVALID_DEVICE_GRANT"}
    val org=grant.getString("organizationId");val venue=grant.getString("venueId")
    require(org==config.getString("organizationId") && venue==config.getString("venueId")) {"DEVICE_SCOPE_MISMATCH"}
    val deviceId=id(grant.getString("deviceId"));val db=writableDatabase;db.beginTransaction()
    try {
      val ref=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device").put("id",deviceId)
      val previous=readSnapshot(ref)
      val state=JSONObject().put("id",deviceId).put("deviceEpoch",grant.getString("deviceEpoch")).put("publicJwk",grant.getJSONObject("publicJwk")).put("status","active").put("certificateFingerprint",grant.getString("certificateFingerprint"))
      db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,"device",deviceId,previous.getInt("version")+1,state.toString()))
      db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      db.setTransactionSuccessful()
    }finally{db.endTransaction()}
  }
  @Synchronized fun checkpoint():JSONObject {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val org=config.getString("organizationId") ?: error("IDENTITY_NOT_PROVISIONED");val venue=config.getString("venueId") ?: error("IDENTITY_NOT_PROVISIONED")
    val device=config.getString("deviceId") ?: error("IDENTITY_NOT_PROVISIONED");val epoch=deviceEpochProvider();val db=writableDatabase
    db.beginTransaction()
    try {
      val sequence=db.rawQuery("SELECT sequence FROM producer_counter WHERE device_id=? AND device_epoch=?",arrayOf(device,epoch)).use {if(it.moveToFirst())it.getString(0) else "0"}
      val cursors=db.rawQuery("SELECT received_cursor,applied_cursor FROM sync_cursor WHERE producer=?",arrayOf("$device:$epoch")).use {if(it.moveToFirst())Pair(it.getString(0),it.getString(1)) else Pair("0","0")}
      val pending=db.rawQuery("SELECT COUNT(*) FROM outbox o JOIN journal j ON j.entry_id=o.journal_entry_id WHERE j.device_id=? AND j.device_epoch=? AND ((o.kind='journal' AND o.cloud_ack=0) OR (o.kind<>'journal' AND o.status IN ('pending','dispatching','unknown')))",arrayOf(device,epoch)).use {it.moveToFirst();it.getInt(0)}
      val now=System.currentTimeMillis()
      val state=JSONObject().put("schemaVersion",1).put("organizationId",org).put("venueId",venue).put("deviceId",device).put("deviceEpoch",epoch).put("coveredSequence",sequence).put("receivedCursor",cursors.first).put("appliedCursor",cursors.second).put("pendingCount",pending).put("status",if(pending==0&&BigInteger(cursors.first)>=BigInteger(sequence)&&cursors.first==cursors.second)"complete" else "pending").put("issuedAtMs",now).put("expiresAtMs",now+30000)
      state.put("signature",DeviceKeys.base64(signer(canonical(state))))
      installCheckpoint(state,JSONObject(publicJwkProvider()))
      db.setTransactionSuccessful();return state
    }finally{db.endTransaction()}
  }
  @Synchronized fun installCheckpoint(state:JSONObject,publicJwk:JSONObject?=null) {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val org=state.getString("organizationId");val venue=state.getString("venueId");val device=id(state.getString("deviceId"));val epoch=state.getString("deviceEpoch")
    require(org==config.getString("organizationId")&&venue==config.getString("venueId")) {"CHECKPOINT_SCOPE_MISMATCH"}
    val ref=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device").put("id",device)
    val enrolled=if(publicJwk!=null)null else readSnapshot(ref).getJSONObject("state")
    if(enrolled!=null)require(enrolled.getString("deviceEpoch")==epoch&&enrolled.getString("status")=="active") {"CHECKPOINT_DEVICE_MISMATCH"}
    val unsigned=JSONObject(state.toString());val signature=unsigned.getString("signature");unsigned.remove("signature")
    require(DeviceKeys.verify((publicJwk?:enrolled!!.getJSONObject("publicJwk")).toString(),canonical(unsigned),DeviceKeys.decode(signature))) {"CHECKPOINT_SIGNATURE_INVALID"}
    val now=System.currentTimeMillis();require(state.getLong("issuedAtMs")<=now+30000&&state.getLong("expiresAtMs")>now&&state.getLong("expiresAtMs")-state.getLong("issuedAtMs")<=30000) {"CHECKPOINT_EXPIRED"}
    val covered=BigInteger(state.getString("coveredSequence"));val received=BigInteger(state.getString("receivedCursor"));val applied=BigInteger(state.getString("appliedCursor"));require(covered.signum()>=0&&received.signum()>=0&&applied.signum()>=0&&applied<=received&&state.getInt("pendingCount")>=0)
    require(state.getString("status")!="complete"||(state.getInt("pendingCount")==0&&received==applied&&applied>=covered)) {"CHECKPOINT_INCOMPLETE"}
    val db=writableDatabase;db.beginTransaction()
    try {
      val checkpointRef=JSONObject(ref.toString()).put("kind","device-checkpoint");val previous=readSnapshot(checkpointRef);val old=previous.getJSONObject("state")
      if(previous.getInt("version")>0)require(state.getLong("issuedAtMs")>=old.getLong("issuedAtMs")&&covered>=BigInteger(old.getString("coveredSequence"))) {"CHECKPOINT_REGRESSION"}
      val watermark=JSONObject(state.toString());watermark.remove("signature");watermark.remove("issuedAtMs");watermark.remove("expiresAtMs")
      val previousWatermark=JSONObject(old.toString());previousWatermark.remove("signature");previousWatermark.remove("issuedAtMs");previousWatermark.remove("expiresAtMs")
      val changed=canonical(watermark).contentEquals(canonical(previousWatermark)).not()
      val version=previous.getInt("version")+if(changed)1 else 0
      db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,"device-checkpoint",device,version,state.toString()))
      if(changed)db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      db.setTransactionSuccessful()
    }finally{db.endTransaction()}
  }
  @Synchronized fun fenceCurrentOwner(handoffId:String):JSONObject {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val org=config.getString("organizationId") ?: error("IDENTITY_NOT_PROVISIONED");val venue=config.getString("venueId") ?: error("IDENTITY_NOT_PROVISIONED")
    val db=writableDatabase;db.beginTransaction()
    try {
      db.rawQuery("SELECT proof_json FROM native_fence WHERE handoff_id=?",arrayOf(handoffId)).use {if(it.moveToFirst()){val proof=JSONObject(it.getString(0));db.setTransactionSuccessful();return proof}}
      val ref=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","ownership").put("id",venue)
      val state=readSnapshot(ref).getJSONObject("state")
      require(state.getString("handoffId")==handoffId && state.getString("status")=="preparing") {"HANDOFF_NOT_PREPARED"}
      val epoch=db.rawQuery("SELECT coordinator_epoch,owner_device_id,owner_device_epoch FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use {require(it.moveToFirst());require(it.getString(1)==config.getString("deviceId")&&it.getString(2)==deviceEpochProvider()) {"COORDINATOR_FENCED"};it.getInt(0)}
      val proof=JSONObject().put("organizationId",org).put("venueId",venue).put("handoffId",handoffId).put("checkpointHash",state.getString("checkpointHash")).put("resourceId","coordinator").put("status","fenced").put("oldEpoch",epoch).put("newEpoch",epoch+1).put("oldOwnerDeviceId",config.getString("deviceId")).put("newOwnerDeviceId",state.getString("newDeviceId"))
      db.execSQL("UPDATE authority SET fenced=1,snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      proof.put("signature",DeviceKeys.base64(signer(canonical(proof))))
      db.execSQL("INSERT INTO native_fence VALUES(?,?)",arrayOf(handoffId,proof.toString()))
      db.setTransactionSuccessful();return proof
    }finally{db.endTransaction()}
  }
  @Synchronized fun commit(batch: JSONObject): JSONObject {
    validateBatch(batch)
    val command = batch.getJSONObject("command")
    val org = command.getString("organizationId"); val venue = command.getString("venueId")
    val operation = command.getString("operationId"); val payloadHash = command.getString("payloadHash")
    val db = writableDatabase
    db.beginTransaction()
    try {
      db.rawQuery("SELECT payload_hash,result_json,sequence,command_fingerprint FROM operation_receipt WHERE organization_id=? AND venue_id=? AND operation_id=?", arrayOf(org,venue,operation)).use { c ->
        if (c.moveToFirst()) {
          check(c.getString(0) == payloadHash && c.getString(3)==commandFingerprint(command)) { "IDEMPOTENCY_CONFLICT" }
          val result = JSONObject(c.getString(1)).put("duplicate", true)
          db.setTransactionSuccessful()
          return JSONObject().put("result", result).put("duplicate", true).put("sequence", c.getString(2)).put("payloadHash",payloadHash).put("committed",true)
        }
      }
      db.rawQuery("SELECT coordinator_epoch,policy_revision,owner_device_id,owner_device_epoch,fenced FROM authority WHERE organization_id=? AND venue_id=?", arrayOf(org,venue)).use { c ->
        check(c.moveToFirst()) { "AUTHORITY_NOT_PROVISIONED" }
        val authority = batch.getJSONObject("expectedAuthority")
        check(c.getInt(0) == authority.getInt("coordinatorEpoch") && command.getInt("coordinatorEpoch") == c.getInt(0)) { "AUTHORITY_CONFLICT" }
        check(c.getInt(1) == authority.getInt("policyRevision") && command.getInt("policyRevision") == c.getInt(1)) { "POLICY_CONFLICT" }
        val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
        val localId=config.getString("deviceId") ?: if(BuildConfig.DEBUG)"device-a" else error("IDENTITY_NOT_PROVISIONED")
        val localEpoch=runCatching {deviceEpochProvider()}.getOrElse {if(BuildConfig.DEBUG)"epoch-a" else throw it}
        val localEvidence=command.getString("type") in setOf("Continuity.CaptureTicket","Continuity.RecordPaymentObservation","SettlementGrant.Use","SettlementGrant.Return")
        if(localEvidence) {
          require(batch.getJSONArray("effects").length()==0) {"LOCAL_EVIDENCE_EFFECT_FORBIDDEN"}
          require(command.getString("deviceId")==localId && command.getString("deviceEpoch")==localEpoch) {"LOCAL_EVIDENCE_DEVICE_MISMATCH"}
          val allowedKinds=when(command.getString("type")){"Continuity.CaptureTicket"->setOf("isolated-ticket","conflict");"Continuity.RecordPaymentObservation"->setOf("payment-observation");"SettlementGrant.Use"->setOf("grant","grant-receipt");else->setOf("grant","grant-return")}
          require((0 until batch.getJSONArray("mutations").length()).all {batch.getJSONArray("mutations").getJSONObject(it).getJSONObject("ref").getString("kind") in allowedKinds}) {"LOCAL_EVIDENCE_MUTATION_FORBIDDEN"}
        }
        val pendingIntent=batch.getJSONObject("result").getString("status")=="pending" && batch.getJSONArray("mutations").length()==0 && (0 until batch.getJSONArray("effects").length()).all {batch.getJSONArray("effects").getJSONObject(it).getString("type")=="command.intent"}
        val handoffCompletion=command.getString("type") in setOf("Ownership.Fence","Ownership.Activate")
        if(c.getInt(4)!=0&&handoffCompletion)require(batch.getJSONArray("effects").length()==0&&(0 until batch.getJSONArray("mutations").length()).all {batch.getJSONArray("mutations").getJSONObject(it).getJSONObject("ref").getString("kind") in setOf("ownership","robot")}) {"HANDOFF_COMPLETION_MUTATION_FORBIDDEN"}
        check(localEvidence||pendingIntent||(localId==c.getString(2)&&localEpoch==c.getString(3)&&(c.getInt(4)==0||handoffCompletion))) {"COORDINATOR_FENCED"}
      }
      val reads = batch.optJSONArray("expectedReads") ?: JSONArray()
      val checkpointTransition=when(command.getString("type")) {
        "Ownership.Fence","Ownership.Activate" -> true
        "Maintenance.Enter" -> command.getJSONObject("payload").optString("mode")=="full_shutdown"
        "Ownership.PrepareHandoff" -> (0 until batch.getJSONArray("mutations").length()).any {batch.getJSONArray("mutations").getJSONObject(it).getJSONObject("newState").optBoolean("cursorComplete",false)}
        "Maintenance.Prepare" -> (0 until batch.getJSONArray("mutations").length()).any {batch.getJSONArray("mutations").getJSONObject(it).getJSONObject("newState").optJSONArray("missingDevices")?.length()==0}
        else -> false
      }
      if(checkpointTransition)requireFreshDeviceCheckpoints(db,org,venue)
      for (index in 0 until reads.length()) {
        val read = reads.getJSONObject(index);val ref = read.getJSONObject("ref")
        if(ref.getString("kind")=="__scope__") {
          require(ref.getString("id")=="authority")
          db.rawQuery("SELECT snapshot_revision FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use { require(it.moveToFirst());if(it.getInt(0)!=read.getInt("expectedVersion"))throw VersionConflict() }
        } else db.rawQuery("SELECT version FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind=? AND id=?",arrayOf(org,venue,ref.getString("kind"),ref.getString("id"))).use {
          val current = if(it.moveToFirst())it.getInt(0) else 0
          if(current != read.getInt("expectedVersion"))throw VersionConflict()

        }
      }
      val mutations = batch.getJSONArray("mutations")
      for (index in 0 until mutations.length()) {
        val mutation = mutations.getJSONObject(index); val ref = mutation.getJSONObject("ref")
        val scope = arrayOf(org,venue,ref.getString("kind"),ref.getString("id"))
        val current = db.rawQuery("SELECT version FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind=? AND id=?", scope).use { if (it.moveToFirst()) it.getInt(0) else 0 }
        if (current != mutation.getInt("expectedVersion")) throw VersionConflict()
        if(ref.getString("kind")=="grant") {
          val next=mutation.getJSONObject("newState")
          if(command.getString("type")=="SettlementGrant.Issue") {
            require(current==0 && next.getString("spentMinor")=="0" && next.getString("status")=="issued") { "INVALID_GRANT" }
            require(next.getString("organizationId")==org && next.getString("venueId")==venue && next.getInt("issuerEpoch")==command.getInt("coordinatorEpoch")) { "GRANT_SCOPE_MISMATCH" }
            val billRef=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","bill").put("id",next.getString("billId"))
            val bill=readSnapshot(billRef)
            require(next.getInt("billVersion")==bill.getInt("version")+1 && next.getString("billSnapshotHash")==immutableBillHash(next.getString("billId"),bill.getJSONObject("state"))) { "GRANT_BILL_CHANGED" }
            require(next.getLong("expiresAtMs")>System.currentTimeMillis() && next.getLong("expiresAtMs")<=System.currentTimeMillis()+86400000) { "INVALID_GRANT_EXPIRY" }
            next.put("signature",DeviceKeys.base64(signer(canonical(grantCapability(next)))))
          } else if(command.getString("type")=="SettlementGrant.Use") {
            val prior=readSnapshot(ref).getJSONObject("state")
            require(prior.getString("status") in setOf("issued","partially_used") && !prior.optBoolean("restorationIncomplete",false)) { "GRANT_RECONCILIATION_REQUIRED" }
            val restrictions=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
            val issuer=db.rawQuery("SELECT public_jwk FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use {it.moveToFirst();it.getString(0)}
            require(DeviceKeys.verify(issuer,canonical(grantCapability(prior)),DeviceKeys.decode(prior.getString("signature")))) { "GRANT_SIGNATURE_INVALID" }
            require(canonical(grantCapability(prior)).contentEquals(canonical(grantCapability(next)))) { "GRANT_CAPABILITY_CHANGED" }
            require(prior.getString("organizationId")==org && prior.getString("venueId")==venue) { "GRANT_SCOPE_MISMATCH" }
            require(command.getString("deviceId")==prior.getString("deviceId") && command.getString("deviceEpoch")==prior.getString("deviceEpoch")) { "GRANT_DEVICE_MISMATCH" }
            val billRef=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","bill").put("id",prior.getString("billId"))
            val bill=readSnapshot(billRef);val billState=bill.getJSONObject("state")
            require(bill.getInt("version")==prior.getInt("billVersion") && billState.getString("grantId")==ref.getString("id") && billState.getBoolean("collectionLocked") && immutableBillHash(prior.getString("billId"),billState)==prior.getString("billSnapshotHash")) { "GRANT_BILL_CHANGED" }
            val receipts=db.rawQuery("SELECT state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='grant-receipt'",arrayOf(org,venue)).use { c ->
              var sum=BigInteger.ZERO
              while(c.moveToNext()) {
                val receipt=JSONObject(c.getString(0))
                if(receipt.getString("grantId")==prior.getString("id")) {
                  require(receipt.getString("billId")==prior.getString("billId") && receipt.getString("currency")==prior.getString("currency") && receipt.getString("deviceId")==prior.getString("deviceId") && receipt.getString("deviceEpoch")==prior.getString("deviceEpoch")) { "GRANT_LEDGER_MISMATCH" }
                  sum+=BigInteger(receipt.getString("amountMinor"))
                }
              }
              sum
            }
            require(receipts==BigInteger(prior.getString("spentMinor"))) { "GRANT_LEDGER_MISMATCH" }
            val receiptMutation=(0 until mutations.length()).map { mutations.getJSONObject(it) }.find { it.getJSONObject("ref").getString("kind")=="grant-receipt" && it.getJSONObject("ref").getString("id")==command.getString("operationId") } ?: error("GRANT_RECEIPT_REQUIRED")
            val receiptState=receiptMutation.getJSONObject("newState")
            require(receiptState.getString("amountMinor")==command.getJSONObject("payload").getString("amountMinor") && receiptState.getString("grantId")==prior.getString("id") && receiptState.getString("billId")==prior.getString("billId") && receiptState.getString("currency")==prior.getString("currency") && receiptState.getString("deviceId")==prior.getString("deviceId") && receiptState.getString("deviceEpoch")==prior.getString("deviceEpoch")) { "GRANT_LEDGER_MISMATCH" }
            require(System.currentTimeMillis()<prior.getLong("expiresAtMs")) { "GRANT_EXPIRED" }
            val spent=BigInteger(prior.getString("spentMinor"));val newSpent=BigInteger(next.getString("spentMinor"));val limit=BigInteger(prior.getString("amountMinor"))
            require(newSpent>spent && newSpent<=limit && newSpent-spent==BigInteger(command.getJSONObject("payload").getString("amountMinor"))) { "GRANT_LIMIT_EXCEEDED" }
            require(prior.getJSONArray("methods").let { methods -> (0 until methods.length()).any { methods.getString(it)==command.getJSONObject("payload").getString("method") } }) { "METHOD_NOT_ALLOWED" }
            require(command.getJSONObject("payload").optString("currency",prior.getString("currency"))==prior.getString("currency")) { "CURRENCY_MISMATCH" }
          }
          for(i in 0 until batch.getJSONArray("events").length()) {
            val data=batch.getJSONArray("events").getJSONObject(i).getJSONObject("data")
            if(data.optString("kind")=="grant" && data.optString("id")==ref.getString("id"))data.put("state",next)
          }
        }
        if(ref.getString("kind")=="grant-return") {
          val localReturn=command.getString("type")=="SettlementGrant.Return"
          require((localReturn||command.getString("type")=="Continuity.AcceptSettlementObservation")&&current==0) {"INVALID_GRANT_RETURN"}
          val proof=mutation.getJSONObject("newState")
          val grantRef=JSONObject().put("organizationId",org).put("venueId",venue).put("kind","grant").put("id",proof.getString("grantId"))
          val grant=readSnapshot(grantRef).getJSONObject("state")
          val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
          if(localReturn)require(config.getString("deviceId")==grant.getString("deviceId") && deviceEpochProvider()==grant.getString("deviceEpoch") && command.getString("deviceId")==grant.getString("deviceId") && command.getString("deviceEpoch")==grant.getString("deviceEpoch")) { "GRANT_RETURN_RECIPIENT_REQUIRED" }
          else {
            require(batch.getJSONArray("effects").length()==0) {"SETTLEMENT_OBSERVATION_EFFECT_FORBIDDEN"}
            verifyObservedReturn(command,proof,grant)
          }
          val closed=if(localReturn)grant else (0 until mutations.length()).map {mutations.getJSONObject(it)}.firstOrNull {it.getJSONObject("ref").getString("kind")=="grant"&&it.getJSONObject("ref").getString("id")==proof.getString("grantId")}?.getJSONObject("newState") ?: error("GRANT_CLOSURE_MUTATION_REQUIRED")
          require(closed.getString("status")=="returned"&&closed.getString("returnProofId")==proof.getString("grantId")&&canonical(grantCapability(closed)).contentEquals(canonical(grantCapability(grant)))) {"GRANT_NOT_CLOSED"}
          require(!grant.optBoolean("restorationIncomplete",false)&&grant.getString("status") in setOf("issued","partially_used","used","returned")) {"GRANT_RECONCILIATION_REQUIRED"}
          val issuer=db.rawQuery("SELECT public_jwk FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use {it.moveToFirst();it.getString(0)}
          require(DeviceKeys.verify(issuer,canonical(grantCapability(grant)),DeviceKeys.decode(grant.getString("signature")))) { "GRANT_SIGNATURE_INVALID" }
          val receipts=mutableListOf<JSONObject>()
          db.rawQuery("SELECT id,state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='grant-receipt'",arrayOf(org,venue)).use {c ->while(c.moveToNext()){val receipt=JSONObject(c.getString(1));if(receipt.getString("grantId")==proof.getString("grantId")){val summary=JSONObject().put("id",c.getString(0));for(key in listOf("grantId","billId","amountMinor","currency","deviceId","deviceEpoch"))summary.put(key,receipt.get(key));receipts.add(summary)}}}
          val sorted=receipts.sortedBy {it.getString("id")};val summaries=JSONArray();val ids=JSONArray();var spent=BigInteger.ZERO
          sorted.forEach {summaries.put(it);ids.put(it.getString("id"));spent+=BigInteger(it.getString("amountMinor"))}
          val receiptHash=MessageDigest.getInstance("SHA-256").digest(JsonCanonicalizer(summaries.toString()).encodedUTF8).joinToString("") {"%02x".format(it)}
          require(proof.getString("organizationId")==org && proof.getString("venueId")==venue && proof.getString("deviceId")==grant.getString("deviceId") && proof.getString("deviceEpoch")==grant.getString("deviceEpoch") && proof.getInt("issuerEpoch")==grant.getInt("issuerEpoch") && proof.getString("spentMinor")==spent.toString() && grant.getString("spentMinor")==spent.toString() && proof.getString("receiptHash")==receiptHash && proof.getJSONArray("receiptIds").toString()==ids.toString()) { "GRANT_RETURN_INVENTORY_MISMATCH" }
          val capability=JSONObject();for(key in listOf("schemaVersion","grantId","organizationId","venueId","deviceId","deviceEpoch","issuerEpoch","spentMinor","receiptIds","receiptHash","returnedAt"))capability.put(key,proof.get(key))
          if(localReturn)proof.put("signature",DeviceKeys.base64(signer(canonical(capability))))
          for(i in 0 until batch.getJSONArray("events").length()) {val data=batch.getJSONArray("events").getJSONObject(i).getJSONObject("data");if(data.optString("kind")=="grant-return" && data.optString("id")==ref.getString("id"))data.put("state",proof)}
        }
        db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)", arrayOf<Any>(org,venue,ref.getString("kind"),ref.getString("id"),current + 1, mutation.getJSONObject("newState").toString()))
        db.execSQL("INSERT OR REPLACE INTO local_dirty VALUES(?,?,?)",arrayOf(ref.getString("kind"),ref.getString("id"),operation))
      }
      val restrictions=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
      if(command.getString("type")=="Configuration.Apply") {
        val configuration=(0 until mutations.length()).map {mutations.getJSONObject(it)}.find {it.getJSONObject("ref").getString("kind")=="configuration" && it.getJSONObject("ref").getString("id")=="applied"} ?: error("CONFIGURATION_MUTATION_REQUIRED")
        val revision=configuration.getJSONObject("newState").getInt("revision")
        require(revision>=command.getInt("policyRevision") && revision==command.getJSONObject("payload").getInt("revision")) {"CONFIGURATION_STALE"}
        db.execSQL("UPDATE authority SET policy_revision=? WHERE organization_id=? AND venue_id=?",arrayOf(revision,org,venue))
      }
      if(command.getString("type")=="Ownership.Activate") {
        val ownership=(0 until mutations.length()).map {mutations.getJSONObject(it)}.find {it.getJSONObject("ref").getString("kind")=="ownership"} ?: error("OWNERSHIP_MUTATION_REQUIRED")
        val state=ownership.getJSONObject("newState")
        require(state.getInt("epoch")==command.getInt("coordinatorEpoch")+1) { "INVALID_OWNERSHIP_EPOCH" }
        db.execSQL("UPDATE authority SET coordinator_epoch=?,owner_device_id=?,owner_device_epoch=?,public_jwk=?,fenced=1 WHERE organization_id=? AND venue_id=?",arrayOf(state.getInt("epoch"),state.getString("owner"),state.getString("deviceEpoch"),state.getJSONObject("publicJwk").toString(),org,venue))
      }
      if(mutations.length()>0)db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      val device=restrictions.getString("deviceId") ?: if(BuildConfig.DEBUG) command.getString("deviceId") else error("IDENTITY_NOT_PROVISIONED")
      val epoch=if(BuildConfig.DEBUG && restrictions.getString("deviceId")==null)command.getString("deviceEpoch") else deviceEpochProvider()
      val previous = db.rawQuery("SELECT sequence FROM producer_counter WHERE device_id=? AND device_epoch=?", arrayOf(device,epoch)).use { if (it.moveToFirst()) BigInteger(it.getString(0)) else BigInteger.ZERO }
      val sequence = (previous + BigInteger.ONE).toString()
      db.execSQL("INSERT OR REPLACE INTO producer_counter VALUES(?,?,?)", arrayOf(device,epoch,sequence))
      val entryId = UUID.randomUUID().toString()
      val payload=JSONObject().put("events",batch.getJSONArray("events")).put("effects",batch.getJSONArray("effects")).put("mutations",batch.getJSONArray("mutations")).put("operationType",command.getString("type")).put("commandEnvelope",command).put("commandResult",batch.getJSONObject("result")).put("commandFingerprint",commandFingerprint(command)).put("commandPayloadHash",command.getString("payloadHash"))
      val mutation=if(mutations.length()>0)mutations.getJSONObject(0) else null
      val timezone=db.rawQuery("SELECT state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='venue-layout' AND id='current'",arrayOf(org,venue)).use {if(it.moveToFirst())JSONObject(it.getString(0)).optString("timezone","UTC") else "UTC"}
      val businessDate=java.time.Instant.parse(command.getString("occurredAt")).atZone(java.time.ZoneId.of(timezone)).toLocalDate().toString()
      val entry=JSONObject().put("schemaVersion",1).put("entryId",entryId).put("operationId",operation).put("organizationId",org).put("venueId",venue)
        .put("deviceId",device).put("deviceEpoch",epoch).put("sequence",sequence).put("coordinatorEpoch",command.getInt("coordinatorEpoch"))
        .put("aggregateType",mutation?.getJSONObject("ref")?.getString("kind") ?: "operation").put("aggregateId",mutation?.getJSONObject("ref")?.getString("id") ?: operation)
        .put("expectedVersion",mutation?.getInt("expectedVersion") ?: 0).put("resultingVersion",(mutation?.getInt("expectedVersion") ?: 0)+1)
        .put("kind",if(batch.getJSONObject("result").getString("status")=="pending")"intent" else if(command.getString("type").startsWith("Import.")) "historical_import" else if(command.getString("type") in setOf("Continuity.CaptureTicket","Continuity.RecordPaymentObservation","SettlementGrant.Use","SettlementGrant.Return"))"observation" else "accepted_fact")
        .put("occurredAt",command.getString("occurredAt")).put("recordedAt",command.getString("recordedAt")).put("timezone",timezone)
        .put("businessDate",businessDate).put("clockConfidence","uncertain").put("actorRef",command.getString("actorRef"))
        .put("payload",payload).put("payloadHash",hash(payload))
      val signature=DeviceKeys.base64(signer(canonical(entry)))
      entry.put("signature",signature)
      require(entry.toString().toByteArray().size<=1000000) {"JOURNAL_TOO_LARGE"}
      db.execSQL("INSERT INTO journal VALUES(?,?,?,?,?,?,?,?,?,?)", arrayOf(entryId,org,venue,device,epoch,sequence,operation,entry.getString("payloadHash"),entry.toString(),signature))
      for(index in 0 until batch.getJSONArray("events").length()) {
        val event=batch.getJSONArray("events").getJSONObject(index)
        db.execSQL("INSERT INTO domain_event VALUES(?,?,?,?,?)",arrayOf(org,venue,"$operation:$index",event.getString("type"),event.getJSONObject("data").toString()))
      }
      db.execSQL("INSERT INTO audit VALUES(?,?,?)", arrayOf(entryId,command.getString("actorRef"),batch.getJSONArray("events").toString()))
      db.execSQL("INSERT INTO outbox(id,journal_entry_id,kind,payload_json,payload_format,venue_observation) VALUES(?,?,?,?,'inner',?)", arrayOf(entryId,entryId,"journal",entry.toString(),venueObservation(entry)))
      val effects = batch.getJSONArray("effects")
      require(entry.getString("kind") !in setOf("historical_import","observation") || effects.length()==0) { "HISTORICAL_EFFECT_FORBIDDEN" }
      for (index in 0 until effects.length()) {
        val effect = effects.getJSONObject(index)
        db.execSQL("INSERT INTO outbox(id,journal_entry_id,kind,payload_json,payload_format) VALUES(?,?,?,?,'inner')", arrayOf(effect.getString("id"),entryId,effect.getString("type"),effect.getJSONObject("payload").toString()))
      }
      val result = batch.getJSONObject("result")
      db.execSQL("INSERT INTO operation_receipt VALUES(?,?,?,?,?,?,?)", arrayOf(org,venue,operation,payloadHash,result.toString(),sequence,commandFingerprint(command)))
      db.setTransactionSuccessful()
      return JSONObject().put("result",result).put("duplicate",false).put("sequence",sequence).put("payloadHash",payloadHash).put("committed",true)
    } finally { db.endTransaction() }
  }
  fun recordIntent(command:JSONObject):JSONObject {
    val scope=JSONObject().put("organizationId",command.getString("organizationId")).put("venueId",command.getString("venueId"))
    val existing=receipt(scope,command.getString("operationId"),command.getString("payloadHash"),command)
    if(existing!=null)return existing.put("duplicate",true)
    val result=JSONObject().put("status","pending").put("operationId",command.getString("operationId")).put("value",JSONObject()).put("duplicate",false).put("ack","local")
    val batch=JSONObject().put("command",command).put("expectedAuthority",JSONObject().put("coordinatorEpoch",command.getInt("coordinatorEpoch")).put("policyRevision",command.getInt("policyRevision")))
      .put("mutations",JSONArray()).put("events",JSONArray().put(JSONObject().put("type","CommandIntentRecorded").put("data",JSONObject().put("command",command))))
      .put("effects",JSONArray().put(JSONObject().put("id",command.getString("operationId")+":intent").put("type","command.intent").put("payload",command))).put("result",result)
    commit(batch);return result
  }
  private fun requireFreshDeviceCheckpoints(db:SQLiteDatabase,org:String,venue:String) {
    val now=System.currentTimeMillis()
    db.rawQuery("SELECT id,state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind='device'",arrayOf(org,venue)).use {devices->
      while(devices.moveToNext()) {
        val device=JSONObject(devices.getString(1));if(device.optString("status")!="active")continue
        val checkpoint=readSnapshot(JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device-checkpoint").put("id",devices.getString(0))).getJSONObject("state")
        val expires=checkpoint.optLong("expiresAtMs",0)
        if(checkpoint.optString("status")!="complete"||checkpoint.optString("deviceEpoch")!=device.optString("deviceEpoch")||checkpoint.optInt("pendingCount",-1)!=0||expires<=now||expires>now+60000)throw VersionConflict()
        val received=checkpoint.optString("receivedCursor");val applied=checkpoint.optString("appliedCursor");val covered=checkpoint.optString("coveredSequence")
        if(listOf(received,applied,covered).any {!Regex("0|[1-9][0-9]*").matches(it)}||received!=applied||BigInteger(applied)<BigInteger(covered))throw VersionConflict()
      }
    }
  }
  private fun verifyObservedReturn(command:JSONObject,proof:JSONObject,grant:JSONObject) {
    val provenance=proof.getJSONObject("provenance");val entry=provenance.getJSONObject("originalJournal")
    val org=command.getString("organizationId");val venue=command.getString("venueId")
    val device=entry.getString("deviceId");val epoch=entry.getString("deviceEpoch")
    require(command.getString("actorRef")=="settlement-sync"&&entry.getInt("schemaVersion")==1&&entry.getString("kind")=="observation"&&entry.getString("organizationId")==org&&entry.getString("venueId")==venue&&device==grant.getString("deviceId")&&epoch==grant.getString("deviceEpoch")) {"SETTLEMENT_SOURCE_MISMATCH"}
    val enrolled=readSnapshot(JSONObject().put("organizationId",org).put("venueId",venue).put("kind","device").put("id",device)).getJSONObject("state")
    require(enrolled.getString("status")=="active"&&enrolled.getString("deviceEpoch")==epoch) {"SETTLEMENT_SOURCE_DEVICE_INVALID"}
    val key=enrolled.getJSONObject("publicJwk").toString();val unsigned=JSONObject(entry.toString());val signature=unsigned.getString("signature");unsigned.remove("signature")
    require(DeviceKeys.verify(key,canonical(unsigned),DeviceKeys.decode(signature))) {"SETTLEMENT_SOURCE_SIGNATURE_INVALID"}
    val payload=entry.getJSONObject("payload")
    require(payload.getString("operationType")=="SettlementGrant.Return"&&entry.getString("payloadHash")==hash(payload)) {"SETTLEMENT_SOURCE_HASH_MISMATCH"}
    val source=command.getJSONObject("payload")
    require(source.getString("sourceEntryId")==entry.getString("entryId")&&source.getString("sourceHash")==entry.getString("payloadHash")&&source.getString("sourceDeviceId")==device&&source.getString("sourceDeviceEpoch")==epoch&&source.getString("sourceSequence")==entry.getString("sequence")&&command.getString("operationId")=="settlement-"+hash(JSONObject().put("entryId",entry.getString("entryId"))).take(32)) {"SETTLEMENT_COMMAND_BINDING_MISMATCH"}
    for(keyName in listOf("entryId","deviceId","deviceEpoch","sequence","payloadHash","signature"))require(provenance.getString(keyName)==entry.getString(keyName)) {"SETTLEMENT_PROVENANCE_MISMATCH"}
    val events=payload.getJSONArray("events")
    fun event(type:String):JSONObject {
      val matched=(0 until events.length()).map {events.getJSONObject(it)}.filter {it.getString("type")==type}
      require(matched.size==1) {"SETTLEMENT_EVENT_REQUIRED"};return matched.single().getJSONObject("data")
    }
    val recorded=event("SettlementGrantReturnRecorded");val returned=event("SettlementGrantReturned")
    val originalProof=JSONObject(proof.toString());originalProof.remove("provenance")
    require(recorded.getString("id")==grant.getString("id")&&recorded.getString("kind")=="grant-return"&&canonical(recorded.getJSONObject("state")).contentEquals(canonical(originalProof))) {"SETTLEMENT_PROOF_MISMATCH"}
    val closed=returned.getJSONObject("state")
    require(returned.getString("id")==grant.getString("id")&&returned.getString("kind")=="grant"&&closed.getString("status")=="returned"&&closed.getString("returnProofId")==grant.getString("id")&&canonical(grantCapability(closed)).contentEquals(canonical(grantCapability(grant)))) {"GRANT_DURABLE_RETURN_REQUIRED"}
    val capability=JSONObject();for(field in listOf("schemaVersion","grantId","organizationId","venueId","deviceId","deviceEpoch","issuerEpoch","spentMinor","receiptIds","receiptHash","returnedAt"))capability.put(field,proof.get(field))
    require(DeviceKeys.verify(key,canonical(capability),DeviceKeys.decode(proof.getString("signature")))) {"GRANT_RETURN_SIGNATURE_INVALID"}
  }
  fun recordVenueReceipt(command:JSONObject,result:JSONObject) {
    require(result.getString("operationId")==command.getString("operationId"))
    if(result.getString("status") !in setOf("accepted","rejected"))return
    val db=writableDatabase;db.beginTransaction()
    try {
      val scope=JSONObject().put("organizationId",command.getString("organizationId")).put("venueId",command.getString("venueId"))
      require(receipt(scope,command.getString("operationId"),command.getString("payloadHash"),command)!=null) { "INTENT_NOT_COMMITTED" }
      db.execSQL("UPDATE operation_receipt SET result_json=? WHERE organization_id=? AND venue_id=? AND operation_id=?",arrayOf(result.toString(),command.getString("organizationId"),command.getString("venueId"),command.getString("operationId")))
      db.execSQL("UPDATE outbox SET status='confirmed' WHERE id=? AND kind='command.intent'",arrayOf(command.getString("operationId")+":intent"))
      db.execSQL("UPDATE outbox SET venue_ack=1 WHERE kind='journal' AND journal_entry_id IN (SELECT entry_id FROM journal WHERE organization_id=? AND venue_id=? AND operation_id=? AND device_id=? AND device_epoch=?)",arrayOf(command.getString("organizationId"),command.getString("venueId"),command.getString("operationId"),command.getString("deviceId"),command.getString("deviceEpoch")))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun pendingVenueObservations():List<JSONObject> {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
    val device=config.getString("deviceId") ?: if(BuildConfig.DEBUG)"device-a" else error("IDENTITY_NOT_PROVISIONED")
    val epoch=runCatching {deviceEpochProvider()}.getOrElse {if(BuildConfig.DEBUG)"epoch-a" else throw it}
    val org=config.getString("organizationId") ?: if(BuildConfig.DEBUG)"org-a" else error("IDENTITY_NOT_PROVISIONED")
    val venue=config.getString("venueId") ?: if(BuildConfig.DEBUG)"venue-a" else error("IDENTITY_NOT_PROVISIONED")
    return readableDatabase.rawQuery("SELECT j.entry_json FROM outbox o JOIN journal j ON j.entry_id=o.journal_entry_id WHERE o.kind='journal' AND o.venue_ack=0 AND o.venue_observation=1 AND j.organization_id=? AND j.venue_id=? AND j.device_id=? AND j.device_epoch=? ORDER BY o.rowid LIMIT 100",arrayOf(org,venue,device,epoch)).use {c->mutableListOf<JSONObject>().apply {while(c.moveToNext())add(JSONObject(c.getString(0)))}}
  }
  fun recordVenueObservationReceipt(entry:JSONObject,result:JSONObject) {
    require(result.getString("status")=="accepted"&&result.getString("operationId")==entry.getString("operationId")&&result.getString("sourceEntryId")==entry.getString("entryId")&&result.getString("sourceHash")==entry.getString("payloadHash")) {"OBSERVATION_RECEIPT_MISMATCH"}
    val db=writableDatabase;db.beginTransaction()
    try {
      db.rawQuery("SELECT payload_hash FROM journal WHERE entry_id=? AND organization_id=? AND venue_id=? AND device_id=? AND device_epoch=?",arrayOf(entry.getString("entryId"),entry.getString("organizationId"),entry.getString("venueId"),entry.getString("deviceId"),entry.getString("deviceEpoch"))).use {require(it.moveToFirst()&&it.getString(0)==entry.getString("payloadHash")) {"OBSERVATION_RECEIPT_MISMATCH"}}
      db.execSQL("UPDATE outbox SET venue_ack=1 WHERE journal_entry_id=? AND kind='journal'",arrayOf(entry.getString("entryId")))
      db.execSQL("DELETE FROM local_dirty WHERE operation_id=?",arrayOf(entry.getString("operationId")))
      db.setTransactionSuccessful()
    }finally{db.endTransaction()}
  }
  fun readSnapshot(ref: JSONObject): JSONObject {
    val args = arrayOf(id(ref.getString("organizationId")),id(ref.getString("venueId")),id(ref.getString("kind")),id(ref.getString("id")))
    return readableDatabase.rawQuery("SELECT version,state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=? AND kind=? AND id=?",args).use {
      if (it.moveToFirst()) JSONObject().put("ref",ref).put("version",it.getInt(0)).put("state",JSONObject(it.getString(1)))
      else JSONObject().put("ref",ref).put("version",0).put("state",JSONObject())
    }
  }
  fun pendingOutbox(): JSONArray = readableDatabase.rawQuery("SELECT id,kind,payload_json FROM outbox WHERE (kind='journal' AND cloud_ack=0) OR (kind<>'journal' AND status IN ('pending','dispatching','unknown')) ORDER BY rowid LIMIT 100",null).use { c ->
    JSONArray().apply { while(c.moveToNext()) put(JSONObject().put("id",c.getString(0)).put("kind",c.getString(1)).put("payload",JSONObject(c.getString(2)))) }
  }
  fun ack(receipt: JSONObject) {
    require(receipt.getString("ack") == "cloud" && receipt.getBoolean("committed")) { "INVALID_ACK" }
    val db = writableDatabase
    db.beginTransaction()
    try {
      val args = arrayOf(receipt.getString("entryId"),receipt.getString("organizationId"),receipt.getString("venueId"),receipt.getString("deviceId"),receipt.getString("deviceEpoch"),receipt.getString("sequence"),receipt.getString("payloadHash"))
      db.rawQuery("SELECT entry_id FROM journal WHERE entry_id=? AND organization_id=? AND venue_id=? AND device_id=? AND device_epoch=? AND producer_sequence=? AND payload_hash=?",args).use { require(it.moveToFirst()) { "ACK_MISMATCH" } }
      db.execSQL("UPDATE outbox SET cloud_ack=1,status='confirmed' WHERE journal_entry_id=? AND kind='journal'",arrayOf(receipt.getString("entryId")))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun snapshots(scope:JSONObject):JSONArray {
    val org=id(scope.getString("organizationId"));val venue=id(scope.getString("venueId"));val db=readableDatabase
    db.beginTransaction()
    try {
      val snapshots=db.rawQuery("SELECT kind,id,version,state_json FROM aggregate_snapshot WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use { c -> JSONArray().apply { while(c.moveToNext())put(JSONObject().put("ref",JSONObject().put("organizationId",org).put("venueId",venue).put("kind",c.getString(0)).put("id",c.getString(1))).put("version",c.getInt(2)).put("state",JSONObject(c.getString(3)))) } }
      db.rawQuery("SELECT coordinator_epoch,policy_revision,snapshot_revision,owner_device_id,owner_device_epoch,public_jwk FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use { c ->
        if(c.moveToFirst()) {
          val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
          val state=JSONObject().put("localDeviceId",config.getString("deviceId","device-a")).put("localDeviceEpoch",runCatching {deviceEpochProvider()}.getOrElse {if(BuildConfig.DEBUG)"epoch-a" else throw it}).put("ownerDeviceId",c.getString(3)).put("deviceEpoch",c.getString(4)).put("publicJwk",JSONObject(c.getString(5))).put("coordinatorEpoch",c.getInt(0)).put("policyRevision",c.getInt(1)).put("nowMs",System.currentTimeMillis())
          snapshots.put(JSONObject().put("ref",JSONObject().put("organizationId",org).put("venueId",venue).put("kind","__scope__").put("id","authority")).put("version",c.getInt(2)).put("state",state))
        }
      }
      db.setTransactionSuccessful();return snapshots
    } finally { db.endTransaction() }
  }
  fun events(scope:JSONObject,type:String?):JSONArray {
    val sql="SELECT type,data_json FROM domain_event WHERE organization_id=? AND venue_id=?"+(if(type!=null)" AND type=?" else "")
    val args=if(type!=null)arrayOf(scope.getString("organizationId"),scope.getString("venueId"),type) else arrayOf(scope.getString("organizationId"),scope.getString("venueId"))
    return readableDatabase.rawQuery(sql,args).use { c ->JSONArray().apply { while(c.moveToNext())put(JSONObject().put("type",c.getString(0)).put("data",JSONObject(c.getString(1)))) } }
  }
  fun receipt(scope:JSONObject,operationId:String,payloadHash:String,command:JSONObject?=null):JSONObject? = readableDatabase.rawQuery("SELECT payload_hash,result_json,command_fingerprint FROM operation_receipt WHERE organization_id=? AND venue_id=? AND operation_id=?",arrayOf(scope.getString("organizationId"),scope.getString("venueId"),operationId)).use {
    if(!it.moveToFirst())null else {check(it.getString(0)==payloadHash && (command==null||it.getString(2)==commandFingerprint(command))){"IDEMPOTENCY_CONFLICT"};JSONObject(it.getString(1))}
  }
  fun journal(scope:JSONObject):JSONArray=readableDatabase.rawQuery("SELECT entry_json FROM journal WHERE organization_id=? AND venue_id=? ORDER BY rowid",arrayOf(scope.getString("organizationId"),scope.getString("venueId"))).use { c ->JSONArray().apply { while(c.moveToNext())put(JSONObject(c.getString(0))) } }
  fun effects(scope:JSONObject,type:String?):JSONArray {
    val sql="SELECT o.id,o.kind,o.payload_json,o.status,o.attempts FROM outbox o JOIN journal j ON j.entry_id=o.journal_entry_id WHERE j.organization_id=? AND j.venue_id=?"+(if(type!=null)" AND o.kind=?" else "")
    val normalized=if(type=="sync.journal")"journal" else type
    val args=if(normalized!=null)arrayOf(scope.getString("organizationId"),scope.getString("venueId"),normalized) else arrayOf(scope.getString("organizationId"),scope.getString("venueId"))
    return readableDatabase.rawQuery(sql,args).use { c ->JSONArray().apply { while(c.moveToNext())put(JSONObject().put("id",c.getString(0)).put("type",if(c.getString(1)=="journal")"sync.journal" else c.getString(1)).put("payload",JSONObject(c.getString(2))).put("status",c.getString(3)).put("attempts",c.getInt(4))) } }
  }
  fun claimEffect(scope:JSONObject,id:String):Boolean {
    val db=writableDatabase
    db.beginTransaction()
    try {
      db.execSQL("UPDATE outbox SET status='dispatching',attempts=attempts+1 WHERE id=? AND status='pending' AND kind<>'journal' AND journal_entry_id IN (SELECT entry_id FROM journal WHERE organization_id=? AND venue_id=?)",arrayOf(id,scope.getString("organizationId"),scope.getString("venueId")))
      val changed=db.rawQuery("SELECT changes()",null).use { it.moveToFirst();it.getInt(0)==1 }
      db.setTransactionSuccessful();return changed
    } finally { db.endTransaction() }
  }
  fun completeEffect(scope:JSONObject,id:String,status:String) {
    require(status in setOf("confirmed","unknown","failed"))
    writableDatabase.execSQL("UPDATE outbox SET status=? WHERE id=? AND status IN ('dispatching','unknown') AND journal_entry_id IN (SELECT entry_id FROM journal WHERE organization_id=? AND venue_id=?)",arrayOf(status,id,scope.getString("organizationId"),scope.getString("venueId")))
  }
  fun verifyCloudAck(ack:JSONObject) {readableDatabase.rawQuery("SELECT hash FROM cloud_ack_receipt WHERE hash=?",arrayOf(hash(ack))).use {require(it.moveToFirst()) {"CLOUD_TRANSPORT_REQUIRED"}}}
  fun recordVerifiedCloudAck(ack:JSONObject) {
    val db=writableDatabase;db.beginTransaction()
    try{acknowledge(ack);db.execSQL("INSERT OR IGNORE INTO cloud_ack_receipt VALUES(?)",arrayOf(hash(ack)));db.setTransactionSuccessful()}finally{db.endTransaction()}
  }
  fun acknowledge(ack:JSONObject) {
    require(ack.getInt("schemaVersion")==1)
    val entries=ack.getJSONArray("entries");require(entries.length()<=100)
    val db=writableDatabase;db.beginTransaction()
    try {
      for(index in 0 until entries.length()) {
        val receipt=JSONObject(entries.getJSONObject(index).toString())
        require(receipt.getString("organizationId")==ack.getString("organizationId") && receipt.getString("venueId")==ack.getString("venueId") && receipt.getString("deviceId")==ack.getString("deviceId") && receipt.getString("deviceEpoch")==ack.getString("deviceEpoch")) { "ACK_SCOPE_MISMATCH" }
        if(receipt.getString("status") in setOf("applied","quarantined") || (receipt.getString("status")=="pending" && BigInteger(receipt.getString("sequence"))<=BigInteger(ack.getString("receivedCursor"))))this.ack(receipt.put("ack","cloud").put("committed",true))
      }
      val producer=ack.getString("deviceId")+":"+ack.getString("deviceEpoch")
      val received=ack.getString("receivedCursor");val applied=ack.getString("appliedCursor")
      require(Regex("0|[1-9][0-9]*").matches(received) && Regex("0|[1-9][0-9]*").matches(applied) && BigInteger(applied)<=BigInteger(received)) { "INVALID_CURSOR" }
      db.rawQuery("SELECT received_cursor,applied_cursor FROM sync_cursor WHERE producer=?",arrayOf(producer)).use { if(it.moveToFirst())require(BigInteger(received)>=BigInteger(it.getString(0)) && BigInteger(applied)>=BigInteger(it.getString(1))) { "CURSOR_REGRESSION" } }
      db.execSQL("INSERT OR REPLACE INTO sync_cursor VALUES(?,?,?)",arrayOf(producer,received,applied))
      db.execSQL("INSERT OR REPLACE INTO sync_status VALUES(1,?)",arrayOf(java.time.Instant.now().toString()))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun applyRemoteSnapshots(response:JSONObject):JSONArray {
    val bundle=response.getJSONObject("bundle");val signature=response.getString("signature")
    require(bundle.toString().toByteArray().size<=1024*1024) { "PROJECTION_TOO_LARGE" }
    val org=id(bundle.getString("organizationId"));val venue=id(bundle.getString("venueId"));val db=writableDatabase
    db.beginTransaction()
    try {
      var currentPolicy=0
      db.rawQuery("SELECT coordinator_epoch,owner_device_id,owner_device_epoch,public_jwk,policy_revision FROM authority WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use {
        require(it.moveToFirst() && it.getInt(0)==bundle.getInt("coordinatorEpoch") && it.getString(1)==bundle.getString("issuerDeviceId") && it.getString(2)==bundle.getString("issuerDeviceEpoch")) { "PROJECTION_AUTHORITY_MISMATCH" }
        require(DeviceKeys.verify(it.getString(3),canonical(bundle),DeviceKeys.decode(signature))) { "INVALID_PROJECTION_SIGNATURE" }
        currentPolicy=it.getInt(4)
      }
      db.rawQuery("SELECT revision FROM projection_cursor WHERE organization_id=? AND venue_id=?",arrayOf(org,venue)).use {
        if(it.moveToFirst())require(bundle.getInt("revision")>=it.getInt(0)) { "STALE_PROJECTION" }
      }
      val snapshots=bundle.getJSONArray("snapshots");require(snapshots.length()<=10000)
      val projected=(0 until snapshots.length()).map {snapshots.getJSONObject(it)}
      val authorities=projected.filter {it.getJSONObject("ref").optString("kind")=="__scope__"&&it.getJSONObject("ref").optString("id")=="authority"}
      require(authorities.size==1) {"PROJECTION_AUTHORITY_REQUIRED"}
      val authority=authorities.single().getJSONObject("state");integer(authority,"policyRevision")
      val policy=authority.getInt("policyRevision");require(policy>=currentPolicy) {"STALE_POLICY_PROJECTION"}
      val configuration=projected.filter {it.getJSONObject("ref").optString("kind")=="configuration"&&it.getJSONObject("ref").optString("id")=="applied"}
      require(configuration.size<=1&&(policy==currentPolicy||configuration.size==1)) {"CONFIGURATION_PROJECTION_REQUIRED"}
      if(configuration.isNotEmpty()) {
        val state=configuration.single().getJSONObject("state");integer(state,"revision")
        require(state.getInt("revision")==policy) {"CONFIGURATION_POLICY_MISMATCH"}
        db.rawQuery("SELECT 1 FROM local_dirty WHERE kind='configuration' AND id='applied'",null).use {require(!it.moveToFirst()) {"CONFIGURATION_LOCAL_CONFLICT"}}
      }
      for(index in 0 until snapshots.length()) {
        val snapshot=snapshots.getJSONObject(index);val ref=snapshot.getJSONObject("ref")
        require(ref.getString("organizationId")==org && ref.getString("venueId")==venue) { "PROJECTION_SCOPE_MISMATCH" }
        val kind=id(ref.getString("kind"));val aggregateId=id(ref.getString("id"));if(kind=="__scope__")continue
        integer(snapshot,"version");val version=snapshot.getInt("version");val state=snapshot.getJSONObject("state")
        if(kind=="device-checkpoint") {
          val local=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions.getString("deviceId")
          if(aggregateId!=local && state.optLong("expiresAtMs",0)>System.currentTimeMillis())installCheckpoint(state)
          continue
        }
        val dirty=db.rawQuery("SELECT 1 FROM local_dirty WHERE kind=? AND id=?",arrayOf(kind,aggregateId)).use {it.moveToFirst()}
        val existing=readSnapshot(ref)
        if(dirty) {
          if(!canonical(existing.getJSONObject("state")).contentEquals(canonical(state)))db.execSQL("INSERT OR REPLACE INTO quarantine VALUES(?,?,?)",arrayOf("projection:$kind:$aggregateId","LOCAL_UNSYNCED_PROJECTION_CONFLICT",snapshot.toString()))
          continue
        }
        require(version>=existing.getInt("version")) { "STALE_AGGREGATE_PROJECTION" }
        db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,kind,aggregateId,version,state.toString()))
      }
      db.execSQL("UPDATE authority SET policy_revision=? WHERE organization_id=? AND venue_id=?",arrayOf(policy,org,venue))
      db.execSQL("INSERT OR REPLACE INTO projection_cursor VALUES(?,?,?,?)",arrayOf(org,venue,bundle.getInt("coordinatorEpoch"),bundle.getInt("revision")))
      db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
    return snapshots(JSONObject().put("organizationId",org).put("venueId",venue))
  }
  fun receiveCloudEntries(entries:JSONArray):JSONObject {
    require(entries.length()<=100 && entries.toString().toByteArray().size<=1048576) {"SYNC_BATCH_TOO_LARGE"}
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions ?: Bundle.EMPTY
    val db=writableDatabase;var applied=0
    db.beginTransaction()
    try {
      for(index in 0 until entries.length()) {
        val entry=entries.getJSONObject(index);val org=id(entry.getString("organizationId"));val venue=id(entry.getString("venueId"));val entryId=id(entry.getString("entryId"))
        require(config.getString("organizationId")==org && config.getString("venueId")==venue && config.getString("deviceId")==entry.getString("deviceId") && entry.getString("deviceEpoch")==deviceEpochProvider()) {"RECOVERY_SCOPE_MISMATCH"}
        val originalSignature=entry.getString("signature");val unsigned=JSONObject(entry.toString());unsigned.remove("signature")
        require(DeviceKeys.verify(DeviceKeys(context).publicJwk(),canonical(unsigned),DeviceKeys.decode(originalSignature))) {"RECOVERY_SIGNATURE_INVALID"}
        require(entry.getString("payloadHash")==hash(entry.getJSONObject("payload"))) {"RECOVERY_HASH_MISMATCH"}
        val existing=db.rawQuery("SELECT entry_json FROM journal WHERE entry_id=? OR (device_id=? AND device_epoch=? AND producer_sequence=?)",arrayOf(entryId,entry.getString("deviceId"),entry.getString("deviceEpoch"),entry.getString("sequence"))).use {if(it.moveToFirst())it.getString(0) else null}
        if(existing!=null){val previous=JSONObject(existing);previous.remove("signature");require(canonical(previous).contentEquals(canonical(unsigned))){"RECOVERY_IDEMPOTENCY_CONFLICT"};applied++;continue}
        db.execSQL("INSERT OR IGNORE INTO inbox VALUES(?,?)",arrayOf(entryId,entry.toString()))
        db.execSQL("SAVEPOINT recover_entry")
        try {
          require(entry.getInt("schemaVersion")==1) {"UNSUPPORTED_SCHEMA"}
          val payload=entry.getJSONObject("payload")
          val command=payload.optJSONObject("commandEnvelope") ?: error("RECOVERY_RECEIPT_METADATA_REQUIRED")
          val result=payload.optJSONObject("commandResult") ?: error("RECOVERY_RECEIPT_METADATA_REQUIRED")
          require(command.getString("organizationId")==org && command.getString("venueId")==venue && command.getString("operationId")==entry.getString("operationId") && result.getString("operationId")==command.getString("operationId") && commandFingerprint(command)==payload.getString("commandFingerprint")) {"RECOVERY_RECEIPT_MISMATCH"}
          val prior=receipt(JSONObject().put("organizationId",org).put("venueId",venue),command.getString("operationId"),command.getString("payloadHash"),command)
          val mutations=payload.getJSONArray("mutations")
          for(i in 0 until mutations.length()) {
            val mutation=mutations.getJSONObject(i);val ref=mutation.getJSONObject("ref")
            require(ref.getString("organizationId")==org && ref.getString("venueId")==venue && ref.getString("kind")!="__scope__") {"RECOVERY_SCOPE_MISMATCH"}
            val current=readSnapshot(ref);val expected=mutation.getInt("expectedVersion");val state=JSONObject(mutation.getJSONObject("newState").toString())
            if(current.getInt("version")<expected)error("RECOVERY_VERSION_GAP")
            if(current.getInt("version")==expected) {
              if(ref.getString("kind")=="grant" && state.optString("status")!="reconciled")state.put("restorationIncomplete",true).put("status","unknown")
              if(ref.getString("kind")=="robot")state.put("goalState","unknown").put("restorationIncomplete",true)
              db.execSQL("INSERT OR REPLACE INTO aggregate_snapshot VALUES(?,?,?,?,?,?)",arrayOf<Any>(org,venue,ref.getString("kind"),ref.getString("id"),expected+1,state.toString()))
            }
          }
          if(prior==null)db.execSQL("INSERT INTO operation_receipt VALUES(?,?,?,?,?,?,?)",arrayOf(org,venue,command.getString("operationId"),command.getString("payloadHash"),result.toString(),entry.getString("sequence"),commandFingerprint(command)))
          db.execSQL("INSERT INTO journal VALUES(?,?,?,?,?,?,?,?,?,?)",arrayOf(entryId,org,venue,entry.getString("deviceId"),entry.getString("deviceEpoch"),entry.getString("sequence"),entry.getString("operationId"),entry.getString("payloadHash"),entry.toString(),originalSignature))
          val counter=db.rawQuery("SELECT sequence FROM producer_counter WHERE device_id=? AND device_epoch=?",arrayOf(entry.getString("deviceId"),entry.getString("deviceEpoch"))).use {if(it.moveToFirst())BigInteger(it.getString(0)) else BigInteger.ZERO}
          val sequence=BigInteger(entry.getString("sequence"));require(sequence>BigInteger.ZERO)
          db.execSQL("INSERT OR REPLACE INTO producer_counter VALUES(?,?,?)",arrayOf(entry.getString("deviceId"),entry.getString("deviceEpoch"),counter.max(sequence).toString()))
          val events=payload.getJSONArray("events")
          for(i in 0 until events.length()){val event=events.getJSONObject(i);db.execSQL("INSERT OR IGNORE INTO domain_event VALUES(?,?,?,?,?)",arrayOf(org,venue,command.getString("operationId")+":"+i,event.getString("type"),event.getJSONObject("data").toString()))}
          db.execSQL("INSERT OR IGNORE INTO audit VALUES(?,?,?)",arrayOf(entryId,entry.getString("actorRef"),events.toString()))
          db.execSQL("INSERT INTO outbox(id,journal_entry_id,kind,payload_json,cloud_ack,status,payload_format,venue_observation) VALUES(?,?,?, ?,1,'confirmed','inner',?)",arrayOf(entryId,entryId,"journal",entry.toString(),venueObservation(entry)))
          val effects=result.getJSONObject("value").optJSONArray("effects") ?: JSONArray()
          for(i in 0 until effects.length()){val effect=effects.getJSONObject(i);db.execSQL("INSERT OR IGNORE INTO outbox(id,journal_entry_id,kind,payload_json,status,payload_format) VALUES(?,?,?,?,'unknown','inner')",arrayOf(effect.getString("id"),entryId,effect.getString("type"),effect.getJSONObject("payload").toString()))}
          db.execSQL("UPDATE authority SET snapshot_revision=snapshot_revision+1 WHERE organization_id=? AND venue_id=?",arrayOf(org,venue))
          db.execSQL("RELEASE recover_entry");applied++
        } catch(error:Exception) {
          db.execSQL("ROLLBACK TO recover_entry");db.execSQL("RELEASE recover_entry")
          db.execSQL("INSERT OR REPLACE INTO quarantine VALUES(?,?,?)",arrayOf(entryId,error.message ?: "RECOVERY_REQUIRES_REVIEW",entry.toString()))
        }
      }
      db.setTransactionSuccessful()
    } finally {db.endTransaction()}
    return JSONObject().put("received",entries.length()).put("applied",applied)
  }
  fun journalCount(): Int = count("journal")
  fun outboxCount(): Int = count("outbox")
  private fun count(table: String): Int = readableDatabase.rawQuery("SELECT count(*) FROM $table",null).use { it.moveToFirst(); it.getInt(0) }
  fun exportRows(): JSONArray = readableDatabase.rawQuery("SELECT entry_json,signature FROM journal ORDER BY rowid",null).use { c -> JSONArray().apply { while(c.moveToNext()) put(JSONObject().put("entry",JSONObject(c.getString(0))).put("signature",c.getString(1))) } }
  companion object {
    fun immutableBillHash(billId:String,bill:JSONObject):String=hash(JSONObject().put("billId",billId).put("totalMinor",bill.get("totalMinor")).put("currency",bill.optString("currency","VND")).put("lines",bill.opt("lines") ?: JSONArray()).put("orderIds",bill.opt("orderIds") ?: JSONArray()).put("sessionId",bill.opt("sessionId") ?: JSONObject.NULL))
    fun commandFingerprint(command:JSONObject):String=hash(JSONObject().apply {
      for(key in listOf("organizationId","venueId","type","actorRef","deviceId","deviceEpoch","coordinatorEpoch","policyRevision","payloadHash"))put(key,command.get(key))
      put("expectedVersion",command.opt("expectedVersion") ?: JSONObject.NULL)
    })
    fun grantCapability(grant:JSONObject):JSONObject = JSONObject().apply {
      for(key in listOf("schemaVersion","id","organizationId","venueId","billId","billVersion","billSnapshotHash","deviceId","deviceEpoch","issuerDeviceId","issuerDeviceEpoch","issuerEpoch","nonce","currency","amountMinor","methods","issuedAt","expiresAt","expiresAtMs"))put(key,grant.get(key))
    }
    fun parseJsonStrict(text:String):JSONObject { JsonCanonicalizer(text);return JSONObject(text) }
    fun canonical(value: JSONObject): ByteArray = JsonCanonicalizer(value.toString()).encodedUTF8
    fun hash(value: JSONObject): String = MessageDigest.getInstance("SHA-256").digest(canonical(value)).joinToString("") { "%02x".format(it) }
    private fun id(value: String): String { require(value.isNotBlank() && value.length <= 128) { "INVALID_ID" }; return value }
    private fun integer(value: JSONObject,key: String) {
      val n=value.get(key)
      require(n is Number && n.toDouble().isFinite() && n.toDouble()>=0 && n.toDouble()<=Int.MAX_VALUE && n.toDouble()==n.toLong().toDouble()) { "INVALID_INTEGER" }
    }
    private fun keys(value: JSONObject, expected: Set<String>) { require(value.keys().asSequence().toSet() == expected) { "INVALID_BATCH_FIELDS" } }
    fun validateBatch(batch: JSONObject) {
      require(batch.toString().toByteArray().size <= 1024*1024) { "BATCH_TOO_LARGE" }
      val requiredBatch=setOf("command","expectedAuthority","mutations","events","effects","result")
      require(batch.keys().asSequence().toSet().let { it.containsAll(requiredBatch) && it.all { key -> key in requiredBatch || key=="expectedReads" } }) { "INVALID_BATCH_FIELDS" }
      val command = batch.getJSONObject("command")
      if(command.optString("type")=="Continuity.CaptureTicket") {
        require(command.toString().toByteArray().size<=65536) {"CAPTURE_TOO_LARGE"}
        val items=command.getJSONObject("payload").optJSONArray("items");require(items==null||items.length()<=100) {"CAPTURE_TOO_LARGE"}
      }
      val required = setOf("schemaVersion","operationId","type","actorRef","deviceId","deviceEpoch","coordinatorEpoch","policyRevision","occurredAt","recordedAt","organizationId","venueId","payload","payloadHash")
      require(command.keys().asSequence().toSet().let { it.containsAll(required) && it.all { key -> key in required || key == "expectedVersion" } }) { "INVALID_COMMAND_FIELDS" }
      require(command.toString().toByteArray().size <= 256*1024 && command.getInt("schemaVersion") == 1) { "INVALID_COMMAND" }
      for (key in listOf("operationId","type","actorRef","deviceId","deviceEpoch","organizationId","venueId")) id(command.getString(key))
      require(command.getString("payloadHash") == hash(command.getJSONObject("payload"))) { "PAYLOAD_HASH_MISMATCH" }
      for(key in listOf("occurredAt","recordedAt")) { require(command.getString(key).endsWith("Z")); java.time.Instant.parse(command.getString(key)) }
      for(key in listOf("schemaVersion","coordinatorEpoch","policyRevision"))integer(command,key)
      if(command.has("expectedVersion"))integer(command,"expectedVersion")
      val authority=batch.getJSONObject("expectedAuthority")
      integer(authority,"coordinatorEpoch");integer(authority,"policyRevision")
      keys(batch.getJSONObject("expectedAuthority"),setOf("coordinatorEpoch","policyRevision"))
      require(batch.getJSONArray("mutations").length() <= 100 && batch.getJSONArray("effects").length() <= 100 && batch.getJSONArray("events").length() <= 100)
      val aggregateKeys = mutableSetOf<String>()
      for (i in 0 until batch.getJSONArray("mutations").length()) {
        val mutation = batch.getJSONArray("mutations").getJSONObject(i)
        keys(mutation,setOf("ref","expectedVersion","newState"))
        val ref = mutation.getJSONObject("ref"); keys(ref,setOf("organizationId","venueId","kind","id"))
        require(ref.getString("organizationId") == command.getString("organizationId") && ref.getString("venueId") == command.getString("venueId")) { "SCOPE_MISMATCH" }
        integer(mutation,"expectedVersion"); mutation.getJSONObject("newState")
        id(ref.getString("kind")); id(ref.getString("id"));require(ref.getString("kind") !in setOf("__scope__","device","device-checkpoint")) { "RESERVED_AGGREGATE_KIND" }
        require(aggregateKeys.add(ref.getString("kind") + ":" + ref.getString("id"))) { "DUPLICATE_MUTATION" }
      }
      val reads=batch.optJSONArray("expectedReads") ?: JSONArray()
      require(reads.length()<=10000)
      for(i in 0 until reads.length()) {
        val read=reads.getJSONObject(i);keys(read,setOf("ref","expectedVersion"));integer(read,"expectedVersion")
        val ref=read.getJSONObject("ref");keys(ref,setOf("organizationId","venueId","kind","id"))
        require(ref.getString("organizationId")==command.getString("organizationId") && ref.getString("venueId")==command.getString("venueId")) { "SCOPE_MISMATCH" }
        id(ref.getString("kind"));id(ref.getString("id"))
      }
      for (i in 0 until batch.getJSONArray("events").length()) { val event=batch.getJSONArray("events").getJSONObject(i);keys(event,setOf("type","data"));id(event.getString("type"));event.getJSONObject("data") }
      for (i in 0 until batch.getJSONArray("effects").length()) { val effect=batch.getJSONArray("effects").getJSONObject(i);keys(effect,setOf("id","type","payload"));id(effect.getString("id"));id(effect.getString("type"));effect.getJSONObject("payload") }
      val result = batch.getJSONObject("result")
      require(result.getString("operationId") == command.getString("operationId") && result.getString("status") in setOf("accepted","rejected","pending","unknown")) { "INVALID_RESULT" }
      require(result.getString("ack") in setOf("none","local","venue","cloud")); result.getJSONObject("value");result.getBoolean("duplicate")
      canonical(batch)
    }
    fun testDatabase(context: Context, signer: ((ByteArray)->ByteArray)? = null): JournalDatabase {
      check(BuildConfig.DEBUG)
      val db = if(signer == null) JournalDatabase(context,"test-${UUID.randomUUID()}.db") else JournalDatabase(context,"test-${UUID.randomUUID()}.db",signer,{"epoch-a"})
      db.provisionForTest();return db
    }
  }
}
