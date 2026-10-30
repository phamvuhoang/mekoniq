package io.mekoniq.tablet.lan

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo

class Discovery(context: Context) {
  private val nsd=context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private var listener:NsdManager.RegistrationListener?=null
  fun advertise(port: Int) {
    val info=NsdServiceInfo().apply { serviceName="MEKONIQ";serviceType="_mekoniq._tcp.";setPort(port) }
    val registration=object:NsdManager.RegistrationListener {
      override fun onServiceRegistered(info:NsdServiceInfo) {}
      override fun onRegistrationFailed(info:NsdServiceInfo,error:Int) {}
      override fun onServiceUnregistered(info:NsdServiceInfo) {}
      override fun onUnregistrationFailed(info:NsdServiceInfo,error:Int) {}
    }
    listener=registration;nsd.registerService(info,NsdManager.PROTOCOL_DNS_SD,registration)
  }
  fun close() { listener?.let { runCatching { nsd.unregisterService(it) } };listener=null }
}
