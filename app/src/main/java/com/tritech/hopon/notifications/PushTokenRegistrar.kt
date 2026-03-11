package com.tritech.hopon.notifications

import android.content.Context
import android.util.Log
import com.google.firebase.messaging.FirebaseMessaging
import com.tritech.hopon.ui.rideDiscovery.core.ApiClient
import com.tritech.hopon.ui.rideDiscovery.core.ApiPushTokenRequest
import com.tritech.hopon.ui.rideDiscovery.core.UsersService
import com.tritech.hopon.utils.SessionManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object PushTokenRegistrar {

    private const val TAG = "PushTokenRegistrar"

    fun syncCurrentToken(context: Context) {
        val appContext = context.applicationContext
        val pending = SessionManager.getPendingPushToken(appContext)
        if (!pending.isNullOrBlank()) {
            sendToken(appContext, pending)
        }

        FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
            if (!task.isSuccessful) {
                Log.w(TAG, "Failed to fetch FCM token", task.exception)
                return@addOnCompleteListener
            }
            val token = task.result?.takeIf { it.isNotBlank() } ?: return@addOnCompleteListener
            registerToken(appContext, token)
        }
    }

    fun registerToken(context: Context, token: String) {
        val appContext = context.applicationContext
        SessionManager.setPushToken(appContext, token)
        if (!SessionManager.isLoggedIn(appContext)) {
            SessionManager.setPendingPushToken(appContext, token)
            return
        }
        sendToken(appContext, token)
    }

    fun unregisterToken(context: Context) {
        val appContext = context.applicationContext
        val token = SessionManager.getPushToken(appContext) ?: return
        if (!SessionManager.isLoggedIn(appContext)) return

        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                ApiClient.create<UsersService>(appContext)
                    .unregisterPushToken(ApiPushTokenRequest(token = token))
            }.onFailure { error ->
                Log.w(TAG, "Failed to unregister push token", error)
            }
        }
    }

    private fun sendToken(context: Context, token: String) {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            runCatching {
                ApiClient.create<UsersService>(context)
                    .registerPushToken(ApiPushTokenRequest(token = token))
                SessionManager.clearPendingPushToken(context)
            }.onFailure { error ->
                SessionManager.setPendingPushToken(context, token)
                Log.w(TAG, "Failed to register push token", error)
            }
        }
    }
}
