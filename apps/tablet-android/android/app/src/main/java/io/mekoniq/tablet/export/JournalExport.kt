package io.mekoniq.tablet.export

import android.content.Context
import android.net.Uri
import android.content.RestrictionsManager
import io.mekoniq.tablet.identity.DeviceKeys
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import org.json.JSONArray
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import java.util.UUID

/** Full, signed, encrypted archive. Restores are staged and never start external effects. */
object JournalExport {
  private val tables=listOf("authority","aggregate_snapshot","operation_receipt","producer_counter","journal","native_fence","sync_status","cloud_ack_receipt","audit","domain_event","outbox","local_dirty","projection_cursor","inbox","sync_cursor","quarantine")
  private const val iterations=600000
  private fun hash(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {"%02x".format(it)}
  private fun derive(password:CharArray,salt:ByteArray):SecretKeySpec {
    require(password.size>=12) { "ARCHIVE_PASSWORD_TOO_SHORT" }
    val spec=PBEKeySpec(password,salt,iterations,256)
    return try {SecretKeySpec(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded,"AES")} finally {spec.clearPassword()}
  }
  fun snapshot(context:Context,journal:JournalDatabase,producerEpoch:String=DeviceKeys(context).deviceEpoch()):JSONObject {
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val org=config.getString("organizationId") ?: error("ENROLLMENT_REQUIRED")
    val venue=config.getString("venueId") ?: error("ENROLLMENT_REQUIRED")
    val device=config.getString("deviceId") ?: error("ENROLLMENT_REQUIRED")
    val db=journal.readableDatabase;val exported=JSONObject()
    db.beginTransaction()
    try {
      for(table in tables) {
        val rows=JSONArray()
        db.rawQuery("SELECT * FROM $table",null).use {cursor ->
          while(cursor.moveToNext()) {
            val row=JSONObject()
            for(index in 0 until cursor.columnCount)row.put(cursor.getColumnName(index),when(cursor.getType(index)){android.database.Cursor.FIELD_TYPE_NULL->JSONObject.NULL;android.database.Cursor.FIELD_TYPE_INTEGER->cursor.getLong(index);android.database.Cursor.FIELD_TYPE_STRING->cursor.getString(index);else->error("UNSUPPORTED_ARCHIVE_COLUMN")})
            rows.put(row)
          }
        }
        exported.put(table,rows)
      }
      db.setTransactionSuccessful()
    } finally {db.endTransaction()}
    return JSONObject().put("schemaVersion",1).put("organizationId",org).put("venueId",venue).put("producer",JSONObject().put("deviceId",device).put("deviceEpoch",producerEpoch)).put("tables",exported).put("preserveOriginalIds",true)
  }
  fun encrypt(context:Context,payload:JSONObject,password:CharArray,signer:(ByteArray)->ByteArray={DeviceKeys(context).sign(it)}):ByteArray {
    val canonical=JournalDatabase.canonical(payload);require(canonical.size<=128*1024*1024){"ARCHIVE_TOO_LARGE"}
    val counts=JSONObject();for(table in tables)counts.put(table,payload.getJSONObject("tables").getJSONArray(table).length())
    val manifest=JSONObject().put("schemaVersion",1).put("createdAt",java.time.Instant.now().toString()).put("payloadHash",hash(canonical)).put("tableCounts",counts)
    val inner=JSONObject().put("manifest",manifest).put("payload",payload).put("snapshotSignature",DeviceKeys.base64(signer(canonical)))
    val random=SecureRandom();val salt=ByteArray(16).also{random.nextBytes(it)};val iv=ByteArray(12).also{random.nextBytes(it)}
    val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,derive(password,salt),GCMParameterSpec(128,iv))
    val plaintext=inner.toString().toByteArray()
    val ciphertext=try{cipher.doFinal(plaintext)}finally{plaintext.fill(0)}
    return JSONObject().put("schemaVersion",1).put("kdf","PBKDF2-SHA256").put("iterations",iterations).put("salt",DeviceKeys.base64(salt)).put("iv",DeviceKeys.base64(iv)).put("ciphertext",DeviceKeys.base64(ciphertext)).toString().toByteArray()
  }
  fun decrypt(context:Context,encrypted:ByteArray,password:CharArray):JSONObject {
    require(encrypted.size<=180*1024*1024){"ARCHIVE_TOO_LARGE"}
    val outer=JournalDatabase.parseJsonStrict(encrypted.toString(Charsets.UTF_8))
    require(outer.getInt("schemaVersion")==1 && outer.getString("kdf")=="PBKDF2-SHA256" && outer.getInt("iterations")==iterations){"UNSUPPORTED_ARCHIVE"}
    val salt=DeviceKeys.decode(outer.getString("salt"));val iv=DeviceKeys.decode(outer.getString("iv"));require(salt.size==16&&iv.size==12)
    val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,derive(password,salt),GCMParameterSpec(128,iv))
    val plain=cipher.doFinal(DeviceKeys.decode(outer.getString("ciphertext")))
    val inner=try{JournalDatabase.parseJsonStrict(plain.toString(Charsets.UTF_8))}finally{plain.fill(0)}
    val payload=inner.getJSONObject("payload");val manifest=inner.getJSONObject("manifest");val canonical=JournalDatabase.canonical(payload)
    require(hash(canonical)==manifest.getString("payloadHash")){"ARCHIVE_HASH_MISMATCH"}
    val config=(context.getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager).applicationRestrictions
    val trustedKey=config.getString("restoreProducerJwk") ?: DeviceKeys(context).publicJwk()
    require(DeviceKeys.verify(trustedKey,canonical,DeviceKeys.decode(inner.getString("snapshotSignature")))){"ARCHIVE_SIGNATURE_INVALID"}
    require(payload.getString("organizationId")==config.getString("organizationId") && payload.getString("venueId")==config.getString("venueId")){"ARCHIVE_SCOPE_MISMATCH"}
    require(payload.getInt("schemaVersion")==1 && payload.getBoolean("preserveOriginalIds")){"UNSUPPORTED_ARCHIVE"}
    val data=payload.getJSONObject("tables");require(data.keys().asSequence().toSet()==tables.toSet()) {"ARCHIVE_TABLES_MISMATCH"}
    for(table in tables)require(data.getJSONArray(table).length()==manifest.getJSONObject("tableCounts").getInt(table)){"ARCHIVE_COUNT_MISMATCH"}
    val producer=payload.getJSONObject("producer")
    val additionalKeys=JSONObject(config.getString("restoreJournalKeys","{}") ?: "{}")
    val journal=data.getJSONArray("journal")
    for(index in 0 until journal.length()) {
      val entry=JournalDatabase.parseJsonStrict(journal.getJSONObject(index).getString("entry_json"))
      val signature=entry.getString("signature");entry.remove("signature")
      val key=if(entry.getString("deviceId")==producer.getString("deviceId") && entry.getString("deviceEpoch")==producer.getString("deviceEpoch"))trustedKey else additionalKeys.optJSONObject(entry.getString("deviceId")+":"+entry.getString("deviceEpoch"))?.toString() ?: error("JOURNAL_KEY_INVENTORY_REQUIRED")
      require(DeviceKeys.verify(key,JournalDatabase.canonical(entry),DeviceKeys.decode(signature))) {"JOURNAL_SIGNATURE_INVALID"}
      require(entry.getString("organizationId")==payload.getString("organizationId") && entry.getString("venueId")==payload.getString("venueId")){"JOURNAL_SCOPE_MISMATCH"}
    }
    return inner
  }
  fun write(context:Context,uri:Uri,journal:JournalDatabase,password:CharArray):JSONObject {
    val payload=snapshot(context,journal);val encrypted=encrypt(context,payload,password)
    try {
      context.contentResolver.openOutputStream(uri,"wt")!!.use {it.write(encrypted);it.flush()}
      val readBack=context.contentResolver.openInputStream(uri)!!.use {it.readBytes()}
      require(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(encrypted),MessageDigest.getInstance("SHA-256").digest(readBack))) {"ARCHIVE_WRITE_INCOMPLETE"}
    } catch(error:Exception) {
      runCatching {android.provider.DocumentsContract.deleteDocument(context.contentResolver,uri)}
      throw error
    }
    return JSONObject().put("uri",uri.toString()).put("sha256",hash(encrypted)).put("committed",true).put("journalCount",payload.getJSONObject("tables").getJSONArray("journal").length())
  }
  fun read(context:Context,uri:Uri,password:CharArray):JSONObject {
    val bytes=context.contentResolver.openInputStream(uri)!!.use {input->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(out.size()<=180*1024*1024){val n=input.read(buffer);if(n<0)break;out.write(buffer,0,n)};out.toByteArray()}
    return decrypt(context,bytes,password)
  }
  fun restoreInactive(context:Context,inner:JSONObject):JSONObject {
    val name="mekoniq-restored-${UUID.randomUUID()}.db"
    try {
      JournalDatabase(context,name).use {journal->
        val db=journal.writableDatabase;val data=inner.getJSONObject("payload").getJSONObject("tables")
        db.beginTransaction()
        try {
          for(table in tables) {
            val columns=db.rawQuery("PRAGMA table_info($table)",null).use {cursor->mutableSetOf<String>().apply{while(cursor.moveToNext())add(cursor.getString(1))}}
            val rows=data.getJSONArray(table)
            for(index in 0 until rows.length()) {
              val row=JSONObject(rows.getJSONObject(index).toString());require(row.keys().asSequence().toSet()==columns){"RESTORE_SCHEMA_MISMATCH"}
              if(table=="outbox" && row.getString("kind")!="journal" && row.getString("status") in setOf("pending","dispatching"))row.put("status","unknown")
              if(table=="aggregate_snapshot" && row.getString("kind")=="grant") {
                val grant=JSONObject(row.getString("state_json"));if(grant.getString("status")!="reconciled"){grant.put("status","unknown").put("restorationIncomplete",true);row.put("state_json",grant.toString())}
              }
              val values=android.content.ContentValues()
              for(column in columns)when(val value=row.get(column)){JSONObject.NULL->values.putNull(column);is Number->values.put(column,value.toLong());is String->values.put(column,value);else->error("INVALID_RESTORE_COLUMN")}
              db.insertOrThrow(table,null,values)
            }
          }
          db.rawQuery("PRAGMA foreign_key_check",null).use { require(!it.moveToFirst()) {"RESTORE_FOREIGN_KEY_VIOLATION"} }
          db.setTransactionSuccessful()
        } finally {db.endTransaction()}
      }
      return JSONObject().put("stagedDatabase",name).put("active",false).put("requiresFencingAndReconciliation",true).put("sourceManifest",inner.getJSONObject("manifest"))
    } catch(error:Exception){context.deleteDatabase(name);throw error}
  }
}
