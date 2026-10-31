package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import io.mekoniq.tablet.identity.DeviceKeys
import org.junit.Assert.*
import org.junit.Test

class DeviceIdentityTest {
  private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
  @Test fun sharedCanonicalVectorsAndExportedSignaturesMatch() {
    val fixtures=org.json.JSONArray(InstrumentationRegistry.getInstrumentation().context.assets.open("canonical.json").bufferedReader().readText())
    val exported=org.json.JSONArray()
    val keys=DeviceKeys(context,"mekoniq-test-golden")
    for(index in 0 until fixtures.length()) {
      val vector=fixtures.getJSONObject(index)
      val canonical=io.mekoniq.tablet.storage.JournalDatabase.canonical(vector.getJSONObject("input"))
      assertEquals(vector.getString("canonical"),canonical.toString(Charsets.UTF_8))
      assertEquals(vector.getString("sha256"),java.security.MessageDigest.getInstance("SHA-256").digest(canonical).joinToString("") { "%02x".format(it) })
      exported.put(org.json.JSONObject().put("canonical",canonical.toString(Charsets.UTF_8)).put("signature",DeviceKeys.base64(keys.sign(canonical))).put("publicJwk",org.json.JSONObject(keys.publicJwk())))
    }
    context.openFileOutput("es256-android.json",0).use { it.write(exported.toString().toByteArray()) }
  }
  @Test fun signatureSurvivesRestartWithoutExportingKey() {
    val keys = DeviceKeys(context, "mekoniq-test")
    val bytes = "{\"a\":\"1\",\"b\":\"2\"}".toByteArray()
    val signature = keys.sign(bytes)
    val reopened = DeviceKeys(context, "mekoniq-test")
    assertTrue(DeviceKeys.verify(reopened.publicJwk(), bytes, signature))
    assertFalse(DeviceKeys.verify(reopened.publicJwk(), bytes + byteArrayOf(1), signature))
    assertEquals(64, signature.size)
    assertEquals(keys.deviceEpoch(), reopened.deviceEpoch())
    assertNull(keys.privateKeyEncoded())
  }
}
