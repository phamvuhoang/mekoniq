package io.mekoniq.tablet.identity

import java.net.HttpURLConnection
import java.net.Socket
import java.net.InetAddress
import javax.net.ssl.SSLSocketFactory
import java.util.concurrent.*
import java.util.concurrent.atomic.AtomicBoolean

/** A cancellation token owns the active socket even across multi-step enrollment. */
class NetworkRequest {
  private val cancelled=AtomicBoolean(false)
  private val sockets=java.util.LinkedHashSet<Socket>()
  @Volatile private var connection:HttpURLConnection?=null
  fun checkActive(){check(!cancelled.get()){ "NETWORK_CANCELLED" }}
  @Synchronized fun attach(value:HttpURLConnection){checkActive();connection=value}
  @Synchronized fun release(value:HttpURLConnection){if(connection===value)connection=null}
  @Synchronized internal fun cancel(){cancelled.set(true)}
  @Synchronized private fun socket(value:Socket):Socket {
    if(cancelled.get()){runCatching {value.close()};error("NETWORK_CANCELLED")}
    sockets.add(value);return value
  }
  fun socketFactory(delegate:SSLSocketFactory):SSLSocketFactory = object:SSLSocketFactory(){
    override fun getDefaultCipherSuites():Array<String> = delegate.defaultCipherSuites
    override fun getSupportedCipherSuites():Array<String> = delegate.supportedCipherSuites
    override fun createSocket():Socket = socket(delegate.createSocket())
    override fun createSocket(raw:Socket,host:String,port:Int,autoClose:Boolean):Socket {
      socket(raw);return socket(delegate.createSocket(raw,host,port,autoClose))
    }
    override fun createSocket(host:String,port:Int):Socket = socket(delegate.createSocket(host,port))
    override fun createSocket(host:String,port:Int,local:InetAddress,localPort:Int):Socket = socket(delegate.createSocket(host,port,local,localPort))
    override fun createSocket(host:InetAddress,port:Int):Socket = socket(delegate.createSocket(host,port))
    override fun createSocket(host:InetAddress,port:Int,local:InetAddress,localPort:Int):Socket = socket(delegate.createSocket(host,port,local,localPort))
  }
  internal fun disconnect(){
    // Closing the underlying TCP socket also interrupts an in-progress TLS handshake.
    val active=synchronized(this){sockets.toList()};active.forEach {runCatching {it.close()}}
    connection?.disconnect()
  }
}

/** Cloud I/O never runs on Capacitor's shared plugin handler. Both queue and lifetime are bounded. */
class NetworkRequests:AutoCloseable {
  private val threads=ThreadFactory { task->Thread(task,"mekoniq-cloud-io").apply {isDaemon=true} }
  private val workers=ThreadPoolExecutor(2,2,0,TimeUnit.MILLISECONDS,ArrayBlockingQueue(8),threads)
  private val deadlines=Executors.newSingleThreadScheduledExecutor(threads)
  private val disconnects=Executors.newFixedThreadPool(2,threads)
  private val tasks=ConcurrentHashMap<String,Task>()
  private class Task(val token:NetworkRequest,val failure:(Exception)->Unit){
    val finished=AtomicBoolean(false)
    lateinit var future:FutureTask<Unit>
    var deadline:ScheduledFuture<*>?=null
  }
  @Synchronized fun <T> submit(id:String,work:(NetworkRequest)->T,success:(T)->Unit,failure:(Exception)->Unit){
    require(Regex("[A-Za-z0-9_.:-]{1,128}").matches(id)){"INVALID_NETWORK_REQUEST_ID"}
    val task=Task(NetworkRequest(),failure)
    task.future=FutureTask {
      try{task.token.checkActive();val result=work(task.token);task.token.checkActive();if(task.finished.compareAndSet(false,true))success(result)}
      catch(error:Exception){if(task.finished.compareAndSet(false,true))failure(error)}
      finally{task.deadline?.cancel(false);tasks.remove(id,task)}
    }
    require(tasks.putIfAbsent(id,task)==null){"DUPLICATE_NETWORK_REQUEST_ID"}
    try{
      task.deadline=deadlines.schedule({cancelTask(id,task)},30,TimeUnit.SECONDS)
      workers.execute(task.future)
    }catch(error:RejectedExecutionException){tasks.remove(id,task);task.deadline?.cancel(false);if(task.finished.compareAndSet(false,true))failure(IllegalStateException("NETWORK_QUEUE_FULL",error))}
  }
  fun cancel(id:String):Boolean = tasks[id]?.let {cancelTask(id,it)} ?: false
  @Synchronized private fun cancelTask(id:String,task:Task):Boolean {
    if(!tasks.remove(id,task))return false
    task.token.cancel();task.future.cancel(true);workers.remove(task.future);task.deadline?.cancel(false)
    // disconnect can itself wait on the HTTP implementation; never make the bridge wait for it.
    disconnects.execute {runCatching {task.token.disconnect()}}
    if(task.finished.compareAndSet(false,true))task.failure(IllegalStateException("NETWORK_CANCELLED"))
    return true
  }
  @Synchronized override fun close(){tasks.keys.toList().forEach {cancel(it)};workers.shutdownNow();deadlines.shutdownNow();disconnects.shutdown()}
}
