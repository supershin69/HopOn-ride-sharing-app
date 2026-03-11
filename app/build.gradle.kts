import com.android.build.gradle.internal.cxx.configure.gradleLocalProperties
// Load values from local.properties (e.g., API keys and mock mode toggle).
val localProps = gradleLocalProperties(rootDir, providers)

// Helper to safely read a property value by key.
fun localProp(name: String): String? = localProps.getProperty(name)?.trim()

val emulatorApiBaseUrl = localProp("apiBaseUrlEmulator")
    ?: "http://10.0.2.2:3001/api/v1/"
val deviceApiBaseUrl = localProp("apiBaseUrlDevice")
    ?: localProp("apiBaseUrl")
    ?: "http://192.168.1.13:3001/api/v1/"

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.tritech.hopon"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tritech.hopon"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildTypes {
        debug {
            // Inject API keys from local.properties into generated string resources.
            resValue(
                "string",
                "google_maps_key",
                localProp("apiKey") ?: ""
            )
            resValue(
                "string",
                "routes_api_key",
                localProp("routesApiKey") ?: ""
            )
            // Inject API base URL into BuildConfig for network layer.
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"$deviceApiBaseUrl\""
            )
            buildConfigField(
                "String",
                "API_BASE_URL_EMULATOR",
                "\"$emulatorApiBaseUrl\""
            )
            buildConfigField(
                "String",
                "API_BASE_URL_DEVICE",
                "\"$deviceApiBaseUrl\""
            )
            buildConfigField(
                "Boolean",
                "USE_SIMULATOR",
                "${localProp("useSimulator") ?: "true"}"
            )
        }
        release {
            // Provide production build with the same key injection source.
            resValue(
                "string",
                "google_maps_key",
                localProp("apiKey") ?: ""
            )
            resValue(
                "string",
                "routes_api_key",
                localProp("routesApiKey") ?: ""
            )
            // Inject API base URL into BuildConfig for network layer.
            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"$deviceApiBaseUrl\""
            )
            buildConfigField(
                "String",
                "API_BASE_URL_EMULATOR",
                "\"$emulatorApiBaseUrl\""
            )
            buildConfigField(
                "String",
                "API_BASE_URL_DEVICE",
                "\"$deviceApiBaseUrl\""
            )
            buildConfigField(
                "Boolean",
                "USE_SIMULATOR",
                "${localProp("useSimulator") ?: "true"}"
            )
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        // Enable Java 8 language features and desugaring support.
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
        isCoreLibraryDesugaringEnabled = true
    }
    kotlinOptions {
        // Align Kotlin bytecode target with Java 8 configuration.
        jvmTarget = "1.8"
    }
    buildFeatures {
        // Enable code/resource generation used by this app module.
        buildConfig = true
        compose = true
        viewBinding = true
    }

}

dependencies {
    // Shared simulator module used for mocked trip/route behavior.
    implementation(project(":simulator"))

    // Jetpack Compose UI stack.
    implementation(platform("androidx.compose:compose-bom:2024.09.03"))
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Google Maps Compose integration.
    implementation("com.google.maps.android:maps-compose:5.0.3") {
        exclude(group = "com.google.android.gms", module = "play-services-maps")
    }

    // Java API desugaring for older Android API levels.
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")

    // Core Android UI/util libraries.
    implementation("androidx.core:core-ktx:1.9.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")

    // Places Library (required for search places)
    implementation("com.google.android.libraries.places:places:3.3.0") {
        exclude(group = "com.google.android.gms", module = "play-services-maps")
    }

    // Location and turn-by-turn/navigation SDKs.
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("com.google.android.libraries.navigation:navigation:latest.release")

    // Networking — Retrofit + OkHttp + Gson converter.
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-gson:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // Coroutines support for Retrofit suspend functions.
    implementation("com.jakewharton.retrofit:retrofit2-kotlin-coroutines-adapter:0.9.2")

    // Socket.IO client for real-time chat (Phase 7).
    implementation("io.socket:socket.io-client:2.1.1") {
        // Exclude org.json which is provided by Android framework.
        exclude(group = "org.json", module = "json")
    }

    // Coroutines runtime + lifecycle scope for Activities/Fragments.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")

    // Unit and instrumentation testing libraries.
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")

    // Firebase 
    implementation(platform("com.google.firebase:firebase-bom:34.10.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-messaging")
}
