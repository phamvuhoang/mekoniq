package io.mekoniq.tablet

import android.os.Bundle
import android.view.WindowManager
import com.getcapacitor.BridgeActivity
import io.mekoniq.tablet.storage.JournalPlugin
import io.mekoniq.tablet.identity.IdentityPlugin
import io.mekoniq.tablet.lan.LanPlugin

class MainActivity : BridgeActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    registerPlugin(JournalPlugin::class.java)
    registerPlugin(IdentityPlugin::class.java)
    registerPlugin(LanPlugin::class.java)
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }
  override fun onResume() {super.onResume();io.mekoniq.tablet.lan.RuntimeQueue.resumeRuntime()}
  override fun onPause() { io.mekoniq.tablet.lan.RuntimeQueue.suspendRuntime(); super.onPause() }
}
