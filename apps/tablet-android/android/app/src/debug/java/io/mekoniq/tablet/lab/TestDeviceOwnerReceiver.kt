package io.mekoniq.tablet.lab

import android.app.admin.DeviceAdminReceiver
/** Only the debug APK contains this receiver; no production device-owner bootstrap is exposed. */
class TestDeviceOwnerReceiver : DeviceAdminReceiver()
