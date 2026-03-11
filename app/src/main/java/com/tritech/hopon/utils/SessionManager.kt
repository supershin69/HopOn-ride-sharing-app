package com.tritech.hopon.utils

import android.content.Context

object SessionManager {

    private const val PREF_NAME = "hopon_session"
    private const val KEY_IS_LOGGED_IN = "is_logged_in"
    private const val KEY_CURRENT_USER_ID = "current_user_id"
    private const val KEY_TOKEN = "auth_token"
    private const val KEY_REFRESH_TOKEN = "refresh_token"
    private const val KEY_DISPLAY_NAME = "display_name"
    private const val KEY_PUSH_TOKEN = "push_token"
    private const val KEY_PENDING_PUSH_TOKEN = "pending_push_token"

    fun isLoggedIn(context: Context): Boolean {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getBoolean(KEY_IS_LOGGED_IN, false)
    }

    fun setLoggedIn(context: Context, isLoggedIn: Boolean) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit()
            .putBoolean(KEY_IS_LOGGED_IN, isLoggedIn)
            .apply {
                if (!isLoggedIn) {
                    remove(KEY_CURRENT_USER_ID)
                    remove(KEY_TOKEN)
                    remove(KEY_REFRESH_TOKEN)
                    remove(KEY_DISPLAY_NAME)
                    remove(KEY_PUSH_TOKEN)
                    remove(KEY_PENDING_PUSH_TOKEN)
                }
            }
            .apply()
    }

    fun getCurrentUserId(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_CURRENT_USER_ID, null)
    }

    fun setCurrentUserId(context: Context, userId: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_CURRENT_USER_ID, userId).apply()
    }

    fun getToken(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_TOKEN, null)
    }

    fun setToken(context: Context, token: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_TOKEN, token).apply()
    }

    fun getRefreshToken(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_REFRESH_TOKEN, null)
    }

    fun setRefreshToken(context: Context, refreshToken: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_REFRESH_TOKEN, refreshToken).apply()
    }

    fun getDisplayName(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_DISPLAY_NAME, null)
    }

    fun setDisplayName(context: Context, name: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_DISPLAY_NAME, name).apply()
    }

    fun getPushToken(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_PUSH_TOKEN, null)
    }

    fun setPushToken(context: Context, token: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_PUSH_TOKEN, token).apply()
    }

    fun clearPushToken(context: Context) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().remove(KEY_PUSH_TOKEN).apply()
    }

    fun getPendingPushToken(context: Context): String? {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        return preferences.getString(KEY_PENDING_PUSH_TOKEN, null)
    }

    fun setPendingPushToken(context: Context, token: String) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().putString(KEY_PENDING_PUSH_TOKEN, token).apply()
    }

    fun clearPendingPushToken(context: Context) {
        val preferences = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        preferences.edit().remove(KEY_PENDING_PUSH_TOKEN).apply()
    }
}
