package com.tritech.hopon.ui.rideDiscovery.core

import com.google.gson.annotations.SerializedName
import com.google.gson.Gson
import com.google.gson.JsonElement
import com.google.gson.JsonObject

// ─── Auth ────────────────────────────────────────────────────────────────────

data class ApiLoginRequest(
    val email: String,
    val password: String
)

data class ApiRegisterRequest(
    val first_name: String,
    val last_name: String,
    val email: String,
    val dob: String,
    val password: String,
    val phone_number: String,
    val role: String = "rider"  // Backend enum: 'rider' | 'driver' | 'admin'
)

data class ApiAuthResponse(
    val userId: String? = null,
    val token: String,
    val refreshToken: String
)

data class ApiRefreshRequest(
    val refreshToken: String
)

data class ApiRefreshResponse(
    val token: String
)

// ─── User ─────────────────────────────────────────────────────────────────────

data class ApiUser(
    @SerializedName("_id")   val id: String,
    val first_name: String,
    val last_name: String,
    val email: String = "",
    val profile_photo: String? = null,
    val phone_number: String? = null,
    val role: String? = null,
    val is_verified: Boolean? = null,
    val verification_status: String? = null,
    val verification_type: String? = null,
    val verification_doc_url: String? = null,
    val verification_notes: String? = null,
    val verified_at: String? = null,
    @SerializedName("average_rating") val rating: Double? = null
) {
    val fullName: String get() = "$first_name $last_name".trim()
}

data class ApiUpdateUserRequest(
    val first_name: String? = null,
    val last_name: String? = null,
    val email: String? = null,
    val profile_photo: String? = null,
    val password: String? = null,
    val current_password: String
)

data class ApiSubmitVerificationRequest(
    val verification_type: String,
    val verification_doc_url: String,
    val verification_notes: String? = null
)

data class ApiVerificationStatus(
    val verification_status: String? = null,
    val verification_type: String? = null,
    val verification_doc_url: String? = null,
    val verification_notes: String? = null,
    val verified_at: String? = null
)

data class ApiPushTokenRequest(
    val token: String,
    val platform: String = "android"
)

data class ApiPushTokenResponse(
    val message: String? = null
)

// ─── Carpool Post (Ride) ──────────────────────────────────────────────────────

/**
 * Matches the CarpoolPost document returned by the car_pool API.
 * `status` is one of: "active" | "in_progress" | "completed" | "cancelled"
 */
data class ApiCarpoolPost(
    @SerializedName("_id")   val id: String,
    val post_id: String? = null,
    @SerializedName("driver_id") private val rawDriverId: JsonElement? = null,
    val start_location_name: String,
    val start_lat: Double,
    val start_lng: Double,
    val end_location_name: String,
    val end_lat: Double,
    val end_lng: Double,
    val departure_time: String,          // ISO 8601
    val total_seats: Int,
    val available_seats: Int,
    val price_per_seat: Double = 0.0,
    val status: String = "active",
    // Fields added in Phase 10 schema alignment (optional until backend adds them)
    val vehicle_info: String? = null,
    val vehicle_plate: String? = null,
    val vehicle_brand: String? = null,
    val vehicle_color: String? = null,
    val contact_info: String? = null,
    val additional_notes: String? = null,
    val wait_time_minutes: Int? = null
) {
    val driver_id: ApiUser
        get() = when {
            rawDriverId == null || rawDriverId.isJsonNull -> ApiUser(id = "", first_name = "", last_name = "")
            rawDriverId.isJsonPrimitive -> ApiUser(
                id = rawDriverId.asString,
                first_name = "",
                last_name = ""
            )
            rawDriverId.isJsonObject -> runCatching {
                gson.fromJson(rawDriverId, ApiUser::class.java)
            }.getOrElse {
                ApiUser(id = "", first_name = "", last_name = "")
            }
            else -> ApiUser(id = "", first_name = "", last_name = "")
        }

    companion object {
        private val gson = Gson()
    }
}

/** Wrapper for list responses: `{ posts: [...] }` or `{ data: [...] }` */
data class ApiPostsResponse(
    val posts: List<ApiCarpoolPost>? = null,
    val data: List<ApiCarpoolPost>? = null
) {
    val items: List<ApiCarpoolPost> get() = posts ?: data ?: emptyList()
}

data class ApiPostResponse(
    val post: ApiCarpoolPost? = null,
    val data: ApiCarpoolPost? = null
) {
    val item: ApiCarpoolPost? get() = post ?: data
}

data class ApiCreatePostRequest(
    val start_location_name: String,
    val start_lat: Double,
    val start_lng: Double,
    val end_location_name: String,
    val end_lat: Double,
    val end_lng: Double,
    val departure_time: String,
    val total_seats: Int,
    val price_per_seat: Double = 0.0,
    val vehicle_info: String? = null,
    val vehicle_plate: String? = null,
    val vehicle_brand: String? = null,
    val vehicle_color: String? = null,
    val contact_info: String? = null,
    val additional_notes: String? = null,
    val wait_time_minutes: Int? = null
)

data class ApiUpdateStatusRequest(
    val status: String
)

data class ApiCreateEmergencyRequest(
    val post_id: String,
    val lat: Double,
    val lng: Double
)

data class ApiEmergencyAlert(
    val alert_id: String? = null,
    @SerializedName("post_id") val post_id: ApiCarpoolPost? = null,
    @SerializedName("reporter_id") val reporter_id: ApiUser? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val resolved: Boolean? = null,
    val created_at: String? = null
)

// ─── Booking ──────────────────────────────────────────────────────────────────

/**
 * `status` is one of: "pending" | "accepted" | "rejected" | "cancelled"
 */
data class ApiBooking(
    @SerializedName("_id")   val id: String,
    @SerializedName("post_id") private val rawPostId: JsonElement? = null,
    @SerializedName("passenger_id") private val rawPassengerId: JsonElement? = null,
    val status: String? = "pending",
    val pickup_status: String? = "not_arrived",
    val arrived_at: String? = null,
    val confirmed_by_driver_at: String? = null,
    val left_behind_at: String? = null,
    val created_at: String? = null
) {
    val post_id: ApiCarpoolPost?
        get() = rawPostId
            ?.takeIf { it.isJsonObject }
            ?.asJsonObject
            ?.let(::parsePostObject)

    val post_uuid: String?
        get() = when {
            rawPostId == null || rawPostId.isJsonNull -> null
            rawPostId.isJsonPrimitive -> rawPostId.asString
            rawPostId.isJsonObject -> {
                val obj = rawPostId.asJsonObject
                obj.get("post_id")?.takeIf { !it.isJsonNull }?.asString
            }
            else -> null
        }

    val passenger_id: ApiUser?
        get() = rawPassengerId
            ?.takeIf { it.isJsonObject }
            ?.let { runCatching { gson.fromJson(it, ApiUser::class.java) }.getOrNull() }

    val passenger_user_id: String?
        get() = when {
            rawPassengerId == null || rawPassengerId.isJsonNull -> null
            rawPassengerId.isJsonPrimitive -> rawPassengerId.asString
            rawPassengerId.isJsonObject -> {
                val obj = rawPassengerId.asJsonObject
                obj.get("_id")?.takeIf { !it.isJsonNull }?.asString
            }
            else -> null
        }

    companion object {
        private val gson = Gson()

        private fun parsePostObject(obj: JsonObject): ApiCarpoolPost? {
            val parsed = runCatching {
                gson.fromJson(obj, ApiCarpoolPost::class.java)
            }.getOrNull()
            if (parsed != null) return parsed

            val driverElement = obj.get("driver_id")
            val fallbackDriver = when {
                driverElement == null || driverElement.isJsonNull -> return null
                driverElement.isJsonPrimitive -> ApiUser(
                    id = driverElement.asString,
                    first_name = "",
                    last_name = ""
                )
                driverElement.isJsonObject -> runCatching {
                    gson.fromJson(driverElement, ApiUser::class.java)
                }.getOrNull() ?: return null
                else -> return null
            }

            return ApiCarpoolPost(
                id = obj.get("_id")?.takeIf { !it.isJsonNull }?.asString ?: return null,
                post_id = obj.get("post_id")?.takeIf { !it.isJsonNull }?.asString,
                rawDriverId = gson.toJsonTree(fallbackDriver),
                start_location_name = obj.get("start_location_name")?.takeIf { !it.isJsonNull }?.asString.orEmpty(),
                start_lat = obj.get("start_lat")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0,
                start_lng = obj.get("start_lng")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0,
                end_location_name = obj.get("end_location_name")?.takeIf { !it.isJsonNull }?.asString.orEmpty(),
                end_lat = obj.get("end_lat")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0,
                end_lng = obj.get("end_lng")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0,
                departure_time = obj.get("departure_time")?.takeIf { !it.isJsonNull }?.asString.orEmpty(),
                total_seats = obj.get("total_seats")?.takeIf { !it.isJsonNull }?.asInt ?: 0,
                available_seats = obj.get("available_seats")?.takeIf { !it.isJsonNull }?.asInt ?: 0,
                price_per_seat = obj.get("price_per_seat")?.takeIf { !it.isJsonNull }?.asDouble ?: 0.0,
                status = obj.get("status")?.takeIf { !it.isJsonNull }?.asString ?: "active",
                vehicle_info = obj.get("vehicle_info")?.takeIf { !it.isJsonNull }?.asString,
                vehicle_plate = obj.get("vehicle_plate")?.takeIf { !it.isJsonNull }?.asString,
                vehicle_brand = obj.get("vehicle_brand")?.takeIf { !it.isJsonNull }?.asString,
                vehicle_color = obj.get("vehicle_color")?.takeIf { !it.isJsonNull }?.asString,
                contact_info = obj.get("contact_info")?.takeIf { !it.isJsonNull }?.asString,
                additional_notes = obj.get("additional_notes")?.takeIf { !it.isJsonNull }?.asString,
                wait_time_minutes = obj.get("wait_time_minutes")?.takeIf { !it.isJsonNull }?.asInt
            )
        }
    }
}

data class ApiBookingsResponse(
    val bookings: List<ApiBooking>? = null,
    val data: List<ApiBooking>? = null
) {
    val items: List<ApiBooking> get() = bookings ?: data ?: emptyList()
}

/**
 * Request body for POST /bookings.
 * [post_id] must be the CarpoolPost UUID `post_id` field, NOT the MongoDB `_id`.
 */
data class ApiCreateBookingRequest(
    val post_id: String
)

data class ApiRespondBookingRequest(
    val status: String   // "accepted" or "rejected"
)

/**
 * Response envelope from PATCH /bookings/:id/cancel.
 * Backend returns `{ message, booking }` \u2014 not the raw booking object.
 */
data class ApiCancelBookingResponse(
    val message: String? = null,
    val booking: ApiBooking? = null
)

// ─── Chat ─────────────────────────────────────────────────────────────────────

data class ApiMessage(
    @SerializedName("_id")   val id: String? = null,
    val post_id: String? = null,
    val sender_id: ApiUser? = null,
    val body: String,
    val sent_at: String? = null
)

data class ApiMessagesResponse(
    val messages: List<ApiMessage>? = null,
    val data: List<ApiMessage>? = null
) {
    val items: List<ApiMessage> get() = messages ?: data ?: emptyList()
}

data class ApiSendMessageRequest(
    val post_id: String,
    val body: String
)

// ─── Generic API envelope ─────────────────────────────────────────────────────

/** Minimal envelope for success/error responses that carry only a message. */
data class ApiMessageResponse(
    val message: String? = null
)

// ─── Tracking ─────────────────────────────────────────────────────────────────

data class ApiTracking(
    @SerializedName("_id")   val id: String? = null,
    val log_id: String? = null,
    val post_id: String? = null,
    val current_lat: Double = 0.0,
    val current_lng: Double = 0.0,
    val eta_minutes: Int? = null,
    val updated_at: String? = null
)

data class ApiUpdateTrackingRequest(
    val current_lat: Double,
    val current_lng: Double,
    val eta_minutes: Int? = null
)

// ─── Payment ──────────────────────────────────────────────────────────────────

data class ApiPayment(
    @SerializedName("_id")   val id: String? = null,
    val payment_id: String? = null,
    val booking_id: String? = null,
    val amount: Double = 0.0,
    val status: String = "pending",
    val transaction_ref: String? = null,
    val created_at: String? = null,
    val payment_date: String? = null,
    val payment_type: String? = null
)

data class ApiCreatePaymentRequest(
    val booking_id: String,
    val amount: Double,
    val status: String = "completed",
    val payment_type: String = "cash"
)

// ─── Feedback ─────────────────────────────────────────────────────────────────

data class ApiFeedback(
    @SerializedName("_id")   val id: String? = null,
    val feedback_id: String? = null,
    val post_id: String? = null,
    val reviewer_id: String? = null,
    val reviewee_id: String? = null,
    val rating: Int = 0,
    val comment: String? = null,
    val created_at: String? = null
)

data class ApiCreateFeedbackRequest(
    val post_id: String,
    val reviewer_id: String,
    val reviewee_id: String,
    val rating: Int,
    val comment: String? = null
)

// ─── Reports ──────────────────────────────────────────────────────────────────

data class ApiReport(
    @SerializedName("_id") val id: String? = null,
    val report_id: String? = null,
    val post_id: String? = null,
    val reporter_id: String? = null,
    val reported_user_id: String? = null,
    val booking_id: String? = null,
    val stage: String,
    val category: String,
    val description: String,
    val status: String = "pending",
    val created_at: String? = null,
    val updated_at: String? = null
)

data class ApiCreateReportRequest(
    val post_id: String,
    val reported_user_id: String,
    val stage: String,
    val category: String,
    val description: String,
    val booking_id: String? = null
)
