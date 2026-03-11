const { v4: uuidv4 } = require('uuid');
const Booking = require('../models/Booking');
const CarpoolPost = require('../models/CarpoolPost');
const { validationResult } = require('express-validator');
const { sendToUsers } = require('../services/pushNotifications');

const CANCEL_CUTOFF_MINUTES = 30;
const PICKUP_STATUS_NOT_ARRIVED = 'not_arrived';
const PICKUP_STATUS_ARRIVED = 'arrived';
const PICKUP_STATUS_BOARDED = 'boarded';
const PICKUP_STATUS_LEFT_BEHIND = 'left_behind';
const CONFIRMED_LIKE_BOOKING_STATUSES = ['confirmed', 'accepted'];

const hideVehicleIdentity = (postLike) => {
  if (!postLike) return postLike;
  // Plate is intentionally visible in ride details for all users.
  return postLike;
};

const hasPassedCancellationCutoff = (departureTime) => {
  if (!departureTime) return false;
  const departureEpoch = new Date(departureTime).getTime();
  if (Number.isNaN(departureEpoch)) return false;
  const cutoffEpoch = departureEpoch - (CANCEL_CUTOFF_MINUTES * 60 * 1000);
  return Date.now() > cutoffEpoch;
};

const hasRideDeparted = (departureTime) => {
  if (!departureTime) return false;
  const departureEpoch = new Date(departureTime).getTime();
  if (Number.isNaN(departureEpoch)) return false;
  // Allow booking up to meetup time inclusive; block only after departure.
  return Date.now() > departureEpoch;
};

const buildBookingStatusNotification = (status) => {
  switch (status) {
    case 'confirmed':
      return { title: 'Booking confirmed', body: 'Your booking request was accepted.' };
    case 'rejected':
      return { title: 'Booking declined', body: 'Your booking request was declined.' };
    case 'cancelled':
      return { title: 'Booking cancelled', body: 'A booking on your ride was cancelled.' };
    default:
      return { title: 'Booking update', body: 'Your booking status was updated.' };
  }
};

const emitRideEvent = (req, postMongoId, eventName, payload) => {
  const io = req.app.get('io');
  if (!io || !postMongoId) return;
  io.to(`post_${postMongoId}`).emit(eventName, payload);
};

const emitUserEvent = (req, userId, eventName, payload) => {
  const io = req.app.get('io');
  if (!io || !userId) return;
  io.to(`user_${userId}`).emit(eventName, payload);
};

// @desc    Request to join a ride
// @route   POST /api/v1/bookings
// @access  Private
const requestBooking = async (req, res) => {
  const { post_id, seats_booked } = req.body;
  const seats = seats_booked || 1;
  const ACTIVE_BOOKING_STATUSES = ['pending', 'accepted', 'confirmed'];

  try {
    // Search by the custom post_id string (UUID) instead of MongoDB _id
    const post = await CarpoolPost.findOne({ post_id: post_id });
    if (!post) return res.status(404).json({ message: 'Ride post not found' });

    if (post.status !== 'active') {
      return res.status(409).json({
        code: 'RIDE_NOT_JOINABLE',
        message: 'This ride is no longer joinable.'
      });
    }

    if (hasRideDeparted(post.departure_time)) {
      return res.status(409).json({
        code: 'RIDE_NOT_JOINABLE',
        message: 'This ride has already departed and can no longer be joined.'
      });
    }

    if (post.driver_id.toString() === req.user.id) {
      return res.status(400).json({ message: 'You cannot book your own ride' });
    }

    if (post.available_seats < seats) {
      return res.status(400).json({ message: 'Not enough seats available' });
    }

    // Block users from holding more than one active booking across rides that are still active/in-progress.
    // Completed/cancelled rides should not block new bookings even if legacy booking.status stayed "confirmed".
    const activeStatusBookings = await Booking.find({
      passenger_id: req.user.id,
      status: { $in: ACTIVE_BOOKING_STATUSES }
    })
      .sort({ booked_at: -1 })
      .lean();

    if (activeStatusBookings.length > 0) {
      const candidatePostUuids = [...new Set(
        activeStatusBookings.map((booking) => booking.post_id).filter(Boolean)
      )];
      const stillActivePosts = await CarpoolPost.find({
        post_id: { $in: candidatePostUuids },
        status: { $in: ['active', 'in_progress'] }
      })
        .select('post_id')
        .lean();
      const activePostUuids = new Set(stillActivePosts.map((activePost) => activePost.post_id));
      const existingActiveBooking = activeStatusBookings.find((booking) =>
        activePostUuids.has(booking.post_id)
      );

      if (existingActiveBooking) {
        const hasActiveBookingForThisPost = existingActiveBooking.post_id === post_id;
        if (hasActiveBookingForThisPost) {
          return res.status(400).json({
            code: 'DUPLICATE_BOOKING_FOR_POST',
            message: 'You already have an active booking for this ride'
          });
        }

        return res.status(409).json({
          code: 'ACTIVE_BOOKING_CONFLICT',
          message: 'You already have an active booking. Cancel your current pending/confirmed ride before joining another.'
        });
      }
    }

    // Legacy same-post check (kept as safety net for race conditions)
    const existingBooking = await Booking.findOne({ 
      post_id, 
      passenger_id: req.user.id,
      status: { $in: ACTIVE_BOOKING_STATUSES }
    });

    if (existingBooking) {
      return res.status(400).json({
        code: 'DUPLICATE_BOOKING_FOR_POST',
        message: 'You already have an active booking for this ride'
      });
    }

    const booking = new Booking({
      booking_id: uuidv4(),
      post_id,
      passenger_id: req.user.id,
      seats_booked: seats,
      status: 'pending',
      pickup_status: PICKUP_STATUS_NOT_ARRIVED
    });

    await booking.save();

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${post.driver_id.toString()}`).emit('booking_requested', {
        booking_id: booking._id.toString(),
        post_id: post._id.toString(),
        post_uuid: post.post_id,
        passenger_id: req.user.id,
        seats_booked: booking.seats_booked
      });
    }

    sendToUsers({
      userIds: [post.driver_id.toString()],
      excludeUserId: req.user.id,
      notification: {
        title: 'New booking request',
        body: 'You received a new booking request.'
      },
      data: {
        type: 'booking_requested',
        booking_id: booking._id.toString(),
        post_id: post._id.toString(),
        post_uuid: post.post_id,
        passenger_id: req.user.id
      }
    }).catch((error) => console.error('Push notification failed:', error.message));
    
    res.status(201).json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Driver responds to a booking request
// @route   PATCH /api/v1/bookings/:id/respond
// @access  Private (Driver only)
const respondToBooking = async (req, res) => {
  const { status } = req.body;
  
  try {
    // Look up booking by MongoDB _id (what Android sends from ApiBooking.id)
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    // Find post by UUID string post_id
    const post = await CarpoolPost.findOne({ post_id: booking.post_id });
    if (!post) return res.status(404).json({ message: 'Ride post not found' });

    // 3. Security check: Is this user the driver?
    if (post.driver_id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the driver can respond' });
    }

    // ... (rest of your logic)
    booking.status = status === 'accepted' ? 'confirmed' : 'rejected';
    
    if (status === 'accepted') {
        if (post.available_seats < booking.seats_booked) {
            return res.status(400).json({ message: 'Not enough seats' });
        }
        post.available_seats -= booking.seats_booked;
        await post.save();
    }

    await booking.save();
    const statusPayload = {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      status: booking.status
    };
    emitRideEvent(req, post._id.toString(), 'booking_status_changed', statusPayload);
    emitUserEvent(req, booking.passenger_id.toString(), 'booking_status_changed', statusPayload);
    emitUserEvent(req, post.driver_id.toString(), 'booking_status_changed', statusPayload);

    const notification = buildBookingStatusNotification(booking.status);
    sendToUsers({
      userIds: [booking.passenger_id.toString()],
      excludeUserId: req.user.id,
      notification,
      data: { type: 'booking_status_changed', ...statusPayload }
    }).catch((error) => console.error('Push notification failed:', error.message));
    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Passenger marks self as arrived/in car for a booking
// @route   PATCH /api/v1/bookings/:id/arrive
// @access  Private (Passenger)
const markBookingArrived = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const post = await CarpoolPost.findOne({ post_id: booking.post_id });
    if (!post) return res.status(404).json({ message: 'Ride post not found' });

    if (booking.passenger_id.toString() !== req.user.id) {
      return res.status(403).json({ message: 'Only the passenger can mark arrival' });
    }

    if (!CONFIRMED_LIKE_BOOKING_STATUSES.includes(booking.status)) {
      return res.status(400).json({ message: 'Only confirmed bookings can check in' });
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'Ride is no longer accepting pickup check-ins' });
    }

    if (booking.pickup_status === PICKUP_STATUS_LEFT_BEHIND) {
      return res.status(400).json({ message: 'You were marked left behind for this ride' });
    }

    if (booking.pickup_status === PICKUP_STATUS_BOARDED) {
      return res.status(400).json({ message: 'You are already confirmed boarded' });
    }

    booking.pickup_status = PICKUP_STATUS_ARRIVED;
    booking.arrived_at = booking.arrived_at || new Date();
    await booking.save();

    emitRideEvent(req, post._id.toString(), 'passenger_arrived', {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      arrived_at: booking.arrived_at
    });
    emitUserEvent(req, post.driver_id.toString(), 'passenger_arrived', {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      arrived_at: booking.arrived_at
    });

    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Driver confirms passenger boarded
// @route   PATCH /api/v1/bookings/:id/confirm-boarded
// @access  Private (Ride host)
const confirmPassengerBoarded = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    const post = await CarpoolPost.findOne({ post_id: booking.post_id });
    if (!post) return res.status(404).json({ message: 'Ride post not found' });

    if (post.driver_id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the ride host can confirm boarded status' });
    }

    if (!CONFIRMED_LIKE_BOOKING_STATUSES.includes(booking.status)) {
      return res.status(400).json({ message: 'Only confirmed bookings can be marked boarded' });
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'Ride is no longer in boarding phase' });
    }

    if (booking.pickup_status === PICKUP_STATUS_LEFT_BEHIND) {
      return res.status(400).json({ message: 'Passenger is already marked left behind' });
    }

    booking.pickup_status = PICKUP_STATUS_BOARDED;
    booking.confirmed_by_driver_at = new Date();
    if (!booking.arrived_at) {
      booking.arrived_at = booking.confirmed_by_driver_at;
    }
    await booking.save();

    emitRideEvent(req, post._id.toString(), 'passenger_boarded', {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      confirmed_by_driver_at: booking.confirmed_by_driver_at
    });
    emitUserEvent(req, booking.passenger_id.toString(), 'passenger_boarded', {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      confirmed_by_driver_at: booking.confirmed_by_driver_at
    });

    res.json(booking);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Cancel a booking
// @route   PATCH /api/v1/bookings/:id/cancel
// @access  Private
const cancelBooking = async (req, res) => {
  try {
    // Look up booking by MongoDB _id (what Android sends from ApiBooking.id)
    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // 2. Manually find the associated post using the UUID string
    // We do this instead of .populate() to avoid the "Cast to ObjectId" error
    const post = await CarpoolPost.findOne({ post_id: booking.post_id });
    
    if (!post) {
      return res.status(404).json({ message: 'Associated ride post not found' });
    }

    // 3. Authorization check
    // Passenger can cancel their own, or Driver can cancel a passenger's booking
    const isPassenger = booking.passenger_id.toString() === req.user.id;
    const isDriver = post.driver_id.toString() === req.user.id;

    if (!isPassenger && !isDriver) {
      return res.status(403).json({ message: 'Not authorized to cancel this booking' });
    }

    if (hasPassedCancellationCutoff(post.departure_time)) {
      return res.status(409).json({
        code: 'CANCEL_CUTOFF_EXCEEDED',
        message: 'Cancellation is not allowed within 30 minutes of departure.'
      });
    }

    // 4. Check if already cancelled
    if (booking.status === 'cancelled') {
      return res.status(400).json({ message: 'Booking is already cancelled' });
    }

    const oldStatus = booking.status;
    booking.status = 'cancelled';
    await booking.save();
    const cancelledPayload = {
      booking_id: booking._id.toString(),
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      passenger_id: booking.passenger_id.toString(),
      cancelled_by: req.user.id,
      status: booking.status
    };
    emitRideEvent(req, post._id.toString(), 'booking_cancelled', cancelledPayload);
    emitUserEvent(req, booking.passenger_id.toString(), 'booking_cancelled', cancelledPayload);
    emitUserEvent(req, post.driver_id.toString(), 'booking_cancelled', cancelledPayload);

    const notification = buildBookingStatusNotification('cancelled');
    sendToUsers({
      userIds: [booking.passenger_id.toString(), post.driver_id.toString()],
      excludeUserId: req.user.id,
      notification,
      data: { type: 'booking_cancelled', ...cancelledPayload }
    }).catch((error) => console.error('Push notification failed:', error.message));

    // 5. If the booking was confirmed/accepted, return the seats to the post
    if (oldStatus === 'confirmed' || oldStatus === 'accepted') {
      // Use the internal _id of the post for the update
      await CarpoolPost.findByIdAndUpdate(post._id, { 
        $inc: { available_seats: booking.seats_booked } 
      });
    }

    const bookingPost = (() => {
      const postObject = post.toObject ? post.toObject() : { ...post };
      const wasConfirmedPassenger = oldStatus === 'confirmed' || oldStatus === 'accepted';
      if (!isDriver && !wasConfirmedPassenger) {
        hideVehicleIdentity(postObject);
      }
      return postObject;
    })();

    res.json({
      message: 'Booking cancelled successfully',
      booking: {
        ...booking._doc,
        post_id: bookingPost // Return the full post object to match expected frontend format
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}; 

// @desc    Get current user's bookings (as passenger)
// @route   GET /api/v1/bookings/me
// @access  Private
const getUserBookings = async (req, res) => {
  try {
    // 1. Get the bookings for the user
    const bookings = await Booking.find({ passenger_id: req.user.id })
      .sort({ booked_at: -1 })
      .lean(); // Use .lean() to get plain JS objects so we can modify them

    // 2. Manually "populate" the posts
    const populatedBookings = await Promise.all(
      bookings.map(async (booking) => {
        const post = await CarpoolPost.findOne({ post_id: booking.post_id })
          .populate('driver_id', 'first_name last_name average_rating is_verified verification_status');
        const postObject = post ? post.toObject() : null;
        if (postObject && !CONFIRMED_LIKE_BOOKING_STATUSES.includes(booking.status)) {
          hideVehicleIdentity(postObject);
        }
        return { ...booking, post_id: postObject }; // Replace the ID string with the post object
      })
    );

    res.json(populatedBookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get bookings for a specific ride post (for driver)
// @route   GET /api/v1/bookings/posts/:id
// @access  Private (Driver only)
const getRideBookings = async (req, res) => {
  try {
   const post = await CarpoolPost.findOne({ post_id: req.params.id });
    if (!post) return res.status(404).json({ message: 'Ride post not found' });

    if (post.driver_id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the ride host can view booking requests' });
    }
   const bookings = await Booking.find({ post_id: post.post_id })
      .populate('passenger_id', 'first_name last_name email phone_number')
      .sort({ booked_at: 1 });
      
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  requestBooking, 
  respondToBooking, 
  markBookingArrived,
  confirmPassengerBoarded,
  cancelBooking, 
  getUserBookings, 
  getRideBookings 
};
