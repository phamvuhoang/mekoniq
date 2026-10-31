package io.mekoniq.tablet

import android.content.Context
import android.content.RestrictionsManager
import android.os.Bundle
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import io.mekoniq.tablet.identity.IdentityPlugin
import io.mekoniq.tablet.lan.RuntimeQueue
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implements
import org.robolectric.annotation.Implementation
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28],shadows=[NoServiceWorkerWebView::class])
class NetworkIsolationTest {
  private class Call(data:JSObject):PluginCall(null,"Identity","network-review","refreshProvisioning",data) {
    val done=CompletableFuture<String>()
    @Volatile var failure:Exception?=null
    override fun resolve(value:JSObject){done.complete("resolved")}
    override fun reject(message:String?,code:String?,error:Exception?){failure=error;done.complete(code?:"rejected")}
  }
  @Test fun stalledProvisioningDoesNotBlockCapacitorHeartbeatOrLanPoll() = withStalledProvisioning {bridge,_,_,_->
    val heartbeat=CompletableFuture<Boolean>()
    bridge.execute {RuntimeQueue.serviceUp=true;RuntimeQueue.resumeRuntime();RuntimeQueue.heartbeat(true);RuntimeQueue.poll();heartbeat.complete(RuntimeQueue.ready())}
    assertTrue("WAN must not hold Capacitor's plugin handler",heartbeat.get(1,TimeUnit.SECONDS))
  }
  @Test fun nativeCancellationClosesTheStalledHttpsSocketAndReleasesTheCall() = withStalledProvisioning {bridge,plugin,call,socket->
    val cancel=Call(JSObject().put("requestId","network-review"))
    bridge.execute {plugin.cancelNetworkRequest(cancel)}
    assertEquals("resolved",cancel.done.get(1,TimeUnit.SECONDS))
    assertEquals("PROVISION_FAILED",call.done.get(1,TimeUnit.SECONDS))
    socket.soTimeout=2000
    while(socket.getInputStream().read()!=-1){} // Drain the TLS hello and observe a real socket EOF.
  }
  private fun withStalledProvisioning(action:(com.getcapacitor.Bridge,IdentityPlugin,Call,Socket)->Unit) {
    org.robolectric.shadows.ShadowWebView.setCurrentWebViewPackage(android.content.pm.PackageInfo().apply {packageName="com.google.android.webview";versionName="130.0.0.0"})
    val activity=Robolectric.buildActivity(MainActivity::class.java).setup()
    val bridge=activity.get().bridge
    val manager=activity.get().getSystemService(Context.RESTRICTIONS_SERVICE) as RestrictionsManager
    val listener=ServerSocket(0,1,java.net.InetAddress.getLoopbackAddress())
    val accepted=CompletableFuture<Socket>()
    val server=Thread {runCatching {accepted.complete(listener.accept())}}.apply {isDaemon=true;start()}
    Shadows.shadowOf(manager).setApplicationRestrictions(Bundle().apply {
      putString("cloudBaseUrl","https://127.0.0.1:${listener.localPort}")
      putString("venueId","venue-a");putString("deviceId","device-a")
    })
    val plugin=bridge.getPlugin("Identity").instance as IdentityPlugin
    val call=Call(JSObject().put("accessToken","local-test-session"))
    try {
      bridge.execute {plugin.refreshProvisioning(call)}
      try{accepted.get(15,TimeUnit.SECONDS)}catch(error:java.util.concurrent.TimeoutException){
        throw AssertionError("TCP fixture not ready; native status=${call.done.getNow("pending")}; error=${call.failure?.message}",error)
      } // TCP accepts but never answers the TLS handshake.
      assertFalse("TCP fixture must have an active stalled native request",call.done.isDone)
      action(bridge,plugin,call,accepted.getNow(null))
    } finally {
      accepted.getNow(null)?.close();listener.close();server.join(1000)
      call.done.get(12,TimeUnit.SECONDS)
      activity.pause().stop().destroy()
    }
  }
}

// Robolectric has no system WebView service-worker provider; keep that unrelated API inert.
@Implements(android.webkit.ServiceWorkerController::class)
@Suppress("DEPRECATION")
class NoServiceWorkerWebView {
  companion object {
    @JvmStatic @Implementation fun getInstance():android.webkit.ServiceWorkerController = object:android.webkit.ServiceWorkerController(){
      override fun getServiceWorkerWebSettings():android.webkit.ServiceWorkerWebSettings = error("Unused WebView settings")
      override fun setServiceWorkerClient(client:android.webkit.ServiceWorkerClient?) {}
    }
  }
}
