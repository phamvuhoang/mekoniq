package io.mekoniq.tablet.identity

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import com.nimbusds.jose.JWSAlgorithm
import com.nimbusds.jose.crypto.impl.ECDSA
import com.nimbusds.jose.jwk.Curve
import com.nimbusds.jose.jwk.ECKey
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import javax.security.auth.x500.X500Principal

class DeviceKeys(context: Context, private val alias: String = "mekoniq-device-v1") {
  private val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
  private val preferences = context.getSharedPreferences("device-identity", Context.MODE_PRIVATE)
  init {
    synchronized(DeviceKeys::class.java) {
      if (!store.containsAlias(alias)) {
        val generator = KeyPairGenerator.getInstance("EC", "AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
          .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
          .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
          .setCertificateSubject(X500Principal("CN=MEKONIQ Device"))
          .build())
        generator.generateKeyPair()
        check(preferences.edit().putString("$alias.epoch", UUID.randomUUID().toString()).commit())
      }
    }
  }
  fun sign(bytes: ByteArray): ByteArray {
    val signer = Signature.getInstance("SHA256withECDSA")
    signer.initSign(store.getKey(alias, null) as java.security.PrivateKey)
    signer.update(bytes)
    return ECDSA.transcodeSignatureToConcat(signer.sign(), 64)
  }
  fun publicJwk(): String = ECKey.Builder(Curve.P_256, store.getCertificate(alias).publicKey as ECPublicKey).build().toPublicJWK().toJSONString()
  fun deviceEpoch(): String = preferences.getString("$alias.epoch", null) ?: error("IDENTITY_EPOCH_MISSING")
  fun privateKeyEncoded(): ByteArray? = store.getKey(alias, null).encoded
  fun certificateBytes(): ByteArray = store.getCertificate(alias).encoded
  fun isHardwareBacked(): Boolean {
    val privateKey = store.getKey(alias, null) as java.security.PrivateKey
    val factory = KeyFactory.getInstance(privateKey.algorithm, "AndroidKeyStore")
    return factory.getKeySpec(privateKey, KeyInfo::class.java).isInsideSecureHardware
  }
  fun keyManagers(): Array<javax.net.ssl.KeyManager> {
    val manager=object:javax.net.ssl.X509ExtendedKeyManager() {
      override fun getClientAliases(keyType:String?,issuers:Array<java.security.Principal>?):Array<String> = emptyArray()
      override fun chooseClientAlias(keyType:Array<String>?,issuers:Array<java.security.Principal>?,socket:java.net.Socket?):String? = null
      override fun getServerAliases(keyType:String?,issuers:Array<java.security.Principal>?):Array<String> = if(keyType=="EC")arrayOf(alias) else emptyArray()
      override fun chooseServerAlias(keyType:String?,issuers:Array<java.security.Principal>?,socket:java.net.Socket?):String?=if(keyType=="EC")alias else null
      override fun getCertificateChain(selected:String?):Array<java.security.cert.X509Certificate>? = if(selected==alias)arrayOf(store.getCertificate(alias) as java.security.cert.X509Certificate) else null
      override fun getPrivateKey(selected:String?):java.security.PrivateKey? = if(selected==alias)store.getKey(alias,null) as java.security.PrivateKey else null
    }
    return arrayOf(manager)
  }
  companion object {
    fun base64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    fun decode(value: String): ByteArray {
      require(Regex("[A-Za-z0-9_-]*").matches(value) && value.length % 4 != 1) {"INVALID_BASE64URL"}
      val bytes=Base64.decode(value,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
      require(base64(bytes)==value) {"NON_CANONICAL_BASE64URL"};return bytes
    }
    fun verify(jwk: String, bytes: ByteArray, signature: ByteArray): Boolean = try {
      ECDSA.ensureLegalSignature(signature, JWSAlgorithm.ES256)
      val verifier = Signature.getInstance("SHA256withECDSA")
      verifier.initVerify(ECKey.parse(jwk).toECPublicKey()); verifier.update(bytes)
      verifier.verify(ECDSA.transcodeSignatureToDER(signature))
    } catch (_: Exception) { false }
  }
}
