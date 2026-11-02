package io.mekoniq.tablet.executor

import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

/**
 * Typed bridge (apps/tablet-android/src/robot-executor-bridge.ts). The WebView passes a RobotCommand, a command id or a stop reason — never
 * a URL, route or raw request; the endpoint comes only from the provisioned profile. Every call also renews the UI lease.
 */
@CapacitorPlugin(name="Executor")
class ExecutorPlugin:Plugin() {
  private fun run(call:PluginCall,code:String,block:(ValetudoExecutor)->JSONObject) = bridge.execute {
    try {
      val executor=ExecutorService.executor(context)
      context.startForegroundService(Intent(context,ExecutorService::class.java))
      call.resolve(JSObject(block(executor).toString()))
    } catch(e:Exception) { call.reject(e.message,code,e) }
  }
  @PluginMethod fun submit(call:PluginCall) = run(call,"EXECUTOR_SUBMIT_FAILED") { it.submit(JSONObject((call.getObject("command") ?: error("INVALID_COMMAND")).toString())) }
  @PluginMethod fun reconcile(call:PluginCall) = run(call,"EXECUTOR_RECONCILE_FAILED") { it.reconcile(call.getString("commandId") ?: error("INVALID_COMMAND_ID")) }
  @PluginMethod fun cancel(call:PluginCall) = run(call,"EXECUTOR_CANCEL_FAILED") { it.cancel(call.getString("commandId") ?: error("INVALID_COMMAND_ID")) }
  @PluginMethod fun requestStop(call:PluginCall) = run(call,"EXECUTOR_STOP_FAILED") { it.requestStop(call.getString("reason") ?: error("STOP_REASON_REQUIRED")) }
  @PluginMethod fun observations(call:PluginCall) = run(call,"EXECUTOR_OBSERVATIONS_FAILED") { JSONObject().put("samples",JSArray(it.observations((call.getDouble("sinceMs") ?: 0.0).toLong()).toString())) }
}
