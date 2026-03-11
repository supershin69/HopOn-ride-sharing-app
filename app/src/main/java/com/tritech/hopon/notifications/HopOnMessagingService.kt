package com.tritech.hopon.notifications

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tritech.hopon.R

class HopOnMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        PushTokenRegistrar.registerToken(applicationContext, token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val title = message.notification?.title
            ?: message.data["title"]
            ?: getString(R.string.ride_updates_notification_title)
        val body = message.notification?.body
            ?: message.data["body"]
            ?: ""

        if (body.isBlank() && title.isBlank()) return

        NotificationHelper.showNotification(
            applicationContext,
            title = title,
            body = body,
            data = message.data
        )
    }
}
