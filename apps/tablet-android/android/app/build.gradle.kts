plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
dependencyLocking { lockAllConfigurations() }
android {
  namespace = "io.mekoniq.tablet"
  compileSdk = 36
  defaultConfig {
    applicationId = "io.mekoniq.tablet"
    minSdk = 26
    targetSdk = 36
    versionCode = 1
    versionName = "0.1.0"
    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }
  buildFeatures { buildConfig = true }
  buildTypes { release { isMinifyEnabled = false } }
  compileOptions { sourceCompatibility = JavaVersion.VERSION_21; targetCompatibility = JavaVersion.VERSION_21 }
  kotlinOptions { jvmTarget = "21" }
  sourceSets.getByName("androidTest").java.srcDir(rootProject.file("../../../tests/android"))
  sourceSets.getByName("androidTest").assets.srcDir(rootProject.file("../../../tests/fixtures/contracts"))
  testOptions { unitTests.isIncludeAndroidResources = true }
}
dependencies {
  implementation(project(":capacitor-android"))
  implementation("androidx.appcompat:appcompat:1.7.1")
  implementation("androidx.core:core-splashscreen:1.2.0")
  implementation("com.nimbusds:nimbus-jose-jwt:10.10")
  implementation("io.github.erdtman:java-json-canonicalization:1.1") { exclude(group = "junit") }
  implementation("org.nanohttpd:nanohttpd:2.3.1")
  implementation("org.nanohttpd:nanohttpd-websocket:2.3.1")
  testImplementation("junit:junit:4.13.2")
  testImplementation("org.robolectric:robolectric:4.15.1")
  androidTestImplementation("androidx.test:runner:1.7.0")
  androidTestImplementation("androidx.test.ext:junit:1.3.0")
  androidTestImplementation("junit:junit:4.13.2")
}
