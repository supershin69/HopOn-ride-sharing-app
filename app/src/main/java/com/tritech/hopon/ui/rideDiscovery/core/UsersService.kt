package com.tritech.hopon.ui.rideDiscovery.core

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Path
import retrofit2.http.POST
import retrofit2.http.PUT

/**
 * Retrofit service for user profile endpoints.
 *
 * Base path: /api/v1/users/
 */
interface UsersService {

    /** Fetch a user's public profile by their MongoDB _id. */
    @GET("users/{id}")
    suspend fun getUser(@Path("id") userId: String): ApiUser

    /** Update the user's profile details with current password confirmation. */
    @PUT("users/{id}")
    suspend fun updateUser(
        @Path("id") userId: String,
        @Body request: ApiUpdateUserRequest
    ): ApiUser

    @POST("users/me/verification")
    suspend fun submitVerification(
        @Body request: ApiSubmitVerificationRequest
    ): ApiVerificationStatus

    @GET("users/me/verification")
    suspend fun getMyVerification(): ApiVerificationStatus

    @POST("users/me/push-token")
    suspend fun registerPushToken(
        @Body request: ApiPushTokenRequest
    ): ApiPushTokenResponse

    @HTTP(method = "DELETE", path = "users/me/push-token", hasBody = true)
    suspend fun unregisterPushToken(
        @Body request: ApiPushTokenRequest
    ): ApiPushTokenResponse
}
