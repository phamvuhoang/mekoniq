package io.mekoniq.tablet

import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ActivityScenario
import android.webkit.WebView
import io.mekoniq.tablet.storage.JournalDatabase
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real bundled DOM actions against the provisioned native coordinator and simulated executor. */
class RestaurantJourneyTest {
  @Test fun bundledPosKitchenRobotAndCashFlow() {
    val instrumentation=InstrumentationRegistry.getInstrumentation();val context=instrumentation.targetContext
    val config=(context.getSystemService(android.content.Context.RESTRICTIONS_SERVICE) as android.content.RestrictionsManager).applicationRestrictions
    require(config.getBoolean("coordinatorEnabled",false)) {"TEST_COORDINATOR_REQUIRED"}
    val scope=JSONObject().put("organizationId",config.getString("organizationId")).put("venueId",config.getString("venueId"))
    require(InstrumentationRegistry.getArguments().getString("testVenue")==scope.getString("venueId")) {"WRONG_TEST_VENUE"}
    JournalDatabase(context).use {db->
      val snapshots=db.snapshots(scope)
      require((0 until snapshots.length()).none {snapshots.getJSONObject(it).getJSONObject("ref").getString("kind") in setOf("order","bill","mission")}) {"FRESH_RESTAURANT_FIXTURE_REQUIRED"}
      require((0 until snapshots.length()).any {snapshots.getJSONObject(it).getJSONObject("ref").getString("kind")=="catalog"}) {"SIGNED_CATALOG_FIXTURE_REQUIRED"}
    }
    ActivityScenario.launch(MainActivity::class.java).use {scenario->
      fun js(code:String):String {val latch=CountDownLatch(1);var value="";scenario.onActivity {activity->activity.bridge.webView.evaluateJavascript(code){value=it;latch.countDown()}};assertTrue(latch.await(5,TimeUnit.SECONDS));return value}
      fun waitUntil(predicate:()->Boolean) {val end=System.currentTimeMillis()+15000;while(System.currentTimeMillis()<end){if(predicate())return;Thread.sleep(100)};fail("NATIVE_UI_TIMEOUT")}
      fun route(path:String){js("history.pushState(null,'','$path');window.dispatchEvent(new PopStateEvent('popstate'));true")}
      fun press(label:String){waitUntil {js("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('"+label+"')&&!b.disabled);if(!b)return false;b.click();return true})()") == "true"}}
      waitUntil {js("Boolean(document.querySelector('nav'))")=="true"}
      route("/pos");press("Cơm");press("Gửi bếp")
      route("/kitchen");press("Sẵn sàng")
      route("/fleet");press("Giữ một phần");press("Tạo chuyến giao");press("Đã xếp đồ");press("Đã giao")
      route("/checkout");press("Mở ca thu ngân");press("Chuẩn bị hóa đơn");press("Xác nhận đã thu tiền mặt");press("Đóng hóa đơn")
      waitUntil {JournalDatabase(context).use {it.events(scope,"BillClosed").length()==1}}
      JournalDatabase(context).use {db->assertEquals(1,db.events(scope,"CashRecorded").length());assertEquals(1,db.events(scope,"MissionCompleted").length())}
    }
  }
}
