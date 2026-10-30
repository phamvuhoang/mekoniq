package io.mekoniq.tablet.lan

import android.content.Context
import android.content.RestrictionsManager
import android.database.sqlite.SQLiteDatabase
import io.mekoniq.tablet.identity.DeviceKeys
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class PairingRegistry(private val context: Context) : AutoCloseable {
  private val db = context.openOrCreateDatabase("mekoniq-pairing.db",Context.MODE_PRIVATE,null)
  init {
    db.execSQL("PRAGMA synchronous=FULL")
    db.execSQL("CREATE TABLE IF NOT EXISTS peer(device_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,venue_id TEXT NOT NULL,jwk TEXT NOT NULL,fingerprint TEXT NOT NULL,grant_json TEXT NOT NULL)")
    db.execSQL("CREATE TABLE IF NOT EXISTS nonce(value TEXT PRIMARY KEY,expires_ms INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)")
    db.execSQL("CREATE TABLE IF NOT EXISTS request_nonce(value TEXT PRIMARY KEY,expires_ms INTEGER NOT NULL)")
  }
  fun offer(endpoint: String, organizationId: String, venueId: String): JSONObject {
    require(endpoint.startsWith("https://"))
    val nonce = UUID.randomUUID().toString();val expires=System.currentTimeMillis()+120000
    db.execSQL("INSERT INTO nonce VALUES(?,?,0)",arrayOf(nonce,expires))
    return JSONObject().put("endpoint",endpoint).put("organizationId",organizationId).put("venueId",venueId).put("nonce",nonce).put("expiresAt",Instant.ofEpochMilli(expires).toString()).put("fingerprint",fingerprint(DeviceKeys(context).certificateBytes()))
  }
  fun accept(offer: JSONObject, grant: JSONObject, grantSignature: String, nonceSignature: String, certificateFingerprint: String) {
    val trustedIssuer = (context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions.getString("enrollmentIssuerJwk") ?: error("ISSUER_NOT_PROVISIONED")
    require(DeviceKeys.verify(trustedIssuer,JournalDatabase.canonical(grant),DeviceKeys.decode(grantSignature))) { "INVALID_ENROLLMENT" }
    require(grant.getString("organizationId") == offer.getString("organizationId") && grant.getString("venueId") == offer.getString("venueId")) { "SCOPE_MISMATCH" }
    require(Instant.parse(grant.getString("expiresAt")).isAfter(Instant.now())) { "GRANT_EXPIRED" }
    require(grant.getString("certificateFingerprint") == certificateFingerprint) { "CERTIFICATE_MISMATCH" }
    val jwk=grant.getJSONObject("publicJwk").toString()
    require(DeviceKeys.verify(jwk,JournalDatabase.canonical(offer),DeviceKeys.decode(nonceSignature))) { "INVALID_NONCE_PROOF" }
    db.beginTransaction()
    try {
      val changed=android.content.ContentValues().apply { put("used",1) }
      require(db.update("nonce",changed,"value=? AND used=0 AND expires_ms>=?",arrayOf(offer.getString("nonce"),System.currentTimeMillis().toString())) == 1) { "NONCE_USED_OR_EXPIRED" }
      JournalDatabase(context).use {it.installSignedPeerDevice(grant,grantSignature)}
      db.execSQL("INSERT OR REPLACE INTO peer VALUES(?,?,?,?,?,?)",arrayOf(grant.getString("deviceId"),grant.getString("organizationId"),grant.getString("venueId"),jwk,certificateFingerprint,grant.toString()))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
  }
  fun authorize(proof: JSONObject, signature: String, method: String, path: String, bodyHash: String, organizationId: String, venueId: String): String {
    require(proof.getString("method") == method && proof.getString("path") == path && proof.getString("bodyHash") == bodyHash) { "PROOF_MISMATCH" }
    require(kotlin.math.abs(System.currentTimeMillis()-proof.getLong("timestampMs")) <= 30000) { "PROOF_EXPIRED" }
    val device=proof.getString("deviceId")
    db.rawQuery("SELECT organization_id,venue_id,jwk FROM peer WHERE device_id=?",arrayOf(device)).use {
      require(it.moveToFirst() && it.getString(0)==organizationId && it.getString(1)==venueId) { "UNPAIRED_DEVICE" }
      require(DeviceKeys.verify(it.getString(2),JournalDatabase.canonical(proof),DeviceKeys.decode(signature))) { "INVALID_DEVICE_PROOF" }
    }
    db.beginTransaction()
    try {
      db.execSQL("DELETE FROM request_nonce WHERE expires_ms<?",arrayOf(System.currentTimeMillis()))
      db.execSQL("INSERT INTO request_nonce VALUES(?,?)",arrayOf(proof.getString("nonce"),System.currentTimeMillis()+60000))
      db.setTransactionSuccessful()
    } finally { db.endTransaction() }
    return device
  }
  fun actorGrant(deviceId:String,allowExpired:Boolean=false):JSONObject= db.rawQuery("SELECT grant_json FROM peer WHERE device_id=?",arrayOf(deviceId)).use { require(it.moveToFirst());JSONObject(it.getString(0)).also { grant -> require(allowExpired || java.time.Instant.parse(grant.getString("expiresAt")).isAfter(java.time.Instant.now())) { "GRANT_EXPIRED" };grant.getString("actorRef");grant.getJSONArray("permissions") } }
  override fun close() { db.close() }
  companion object {
    fun fingerprint(bytes: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
  }
}
