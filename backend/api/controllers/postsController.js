const { v4: uuidv4 } = require('uuid');
const CarpoolPost = require('../models/CarpoolPost');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Feedback = require('../models/Feedback');
const { body, validationResult } = require('express-validator');
const { sendToUsers } = require('../services/pushNotifications');

const ACTIVE_HOST_RIDE_STATUSES = ['active', 'in_progress'];
const CANCEL_CUTOFF_MINUTES = 30;
const PICKUP_STATUS_BOARDED = 'boarded';
const PICKUP_STATUS_LEFT_BEHIND = 'left_behind';
const VERIFIED_STATUSES = ['verified'];
const CONFIRMED_LIKE_BOOKING_STATUSES = ['confirmed', 'accepted'];
const ACTIVE_BOOKING_STATUSES = ['pending', 'accepted', 'confirmed'];

const toIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

const hideVehicleIdentity = (postLike) => {
  if (!postLike) return postLike;
  // Plate is intentionally visible in ride details for all users.
  return postLike;
};

const getConfirmedBookingPostIdsForUser = async (userId, postUuids) => {
  if (!userId || postUuids.length === 0) return new Set();
  const confirmed = await Booking.find({
    passenger_id: userId,
    status: { $in: CONFIRMED_LIKE_BOOKING_STATUSES },
    post_id: { $in: postUuids }
  }).select('post_id').lean();
  return new Set(confirmed.map((item) => item.post_id));
};

const hasPassedCancellationCutoff = (departureTime) => {
  if (!departureTime) return false;
  const departureEpoch = new Date(departureTime).getTime();
  if (Number.isNaN(departureEpoch)) return false;
  const cutoffEpoch = departureEpoch - (CANCEL_CUTOFF_MINUTES * 60 * 1000);
  return Date.now() > cutoffEpoch;
};

const buildRideStatusNotification = (status) => {
  switch (status) {
    case 'cancelled':
      return { title: 'Ride cancelled', body: 'A ride you are part of was cancelled.' };
    case 'completed':
      return { title: 'Ride completed', body: 'Your ride has been marked completed.' };
    case 'in_progress':
      return { title: 'Ride started', body: 'Your ride is now in progress.' };
    case 'active':
      return { title: 'Ride active', body: 'Your ride is now active.' };
    default:
      return { title: 'Ride update', body: `Ride status changed to ${status}.` };
  }
};

const buildUpcomingJoinableFilter = () => ({
  status: 'active',
  available_seats: { $gt: 0 },
  departure_time: { $gte: new Date() }
});

const emitRideEvent = (req, postMongoId, eventName, payload) => {
  const io = req.app.get('io');
  if (!io || !postMongoId) return;
  io.to(`post_${postMongoId}`).emit(eventName, payload);
};

const emitRideEventToUsers = (req, userIds, eventName, payload) => {
  const io = req.app.get('io');
  if (!io || !Array.isArray(userIds)) return;
  const uniqueUserIds = [...new Set(userIds.filter(Boolean).map((id) => String(id)))];
  uniqueUserIds.forEach((userId) => {
    io.to(`user_${userId}`).emit(eventName, payload);
  });
};

const getRideParticipantUserIds = async (post) => {
  if (!post) return [];
  const relatedBookings = await Booking.find({
    post_id: post.post_id,
    status: { $in: ['pending', 'accepted', 'confirmed'] }
  })
    .select('passenger_id')
    .lean();
  return [
    post.driver_id?.toString(),
    ...relatedBookings.map((item) => item.passenger_id?.toString())
  ];
};

const getPosts = async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;
    console.log('getPosts received query:', { lat, lng, radius }); // Log received query params

    let posts;

    const DEFAULT_RADIUS_KM = 5;
    if (lat && lng) {
      const radiusKm = radius ? parseFloat(radius) : DEFAULT_RADIUS_KM;
      console.log('Performing geo search with:', { lat: parseFloat(lat), lng: parseFloat(lng), radiusKm });
      posts = await CarpoolPost.aggregate([
        {
          $geoNear: {
            near: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
            distanceField: 'distance',
            maxDistance: radiusKm * 1000, // km to meters
            spherical: true,
            key: 'end_location', // Search by ride destination, not pickup point
            query: buildUpcomingJoinableFilter()
          }
        },
        { $sort: { distance: 1 } },
        {
          $lookup: {
            from: 'users',
            localField: 'driver_id',
            foreignField: '_id',
            as: 'driver'
          }
        },
        { $unwind: '$driver' },
        {
          $project: {
            _id: 1,
            post_id: 1,
            start_location_name: 1,
            start_lat: 1,
            start_lng: 1,
            end_location_name: 1,
            end_lat: 1,
            end_lng: 1,
            departure_time: 1,
            total_seats: 1,
            available_seats: 1,
            price_per_seat: 1,
            status: 1,
            vehicle_info: 1,
            vehicle_plate: 1,
            vehicle_brand: 1,
            vehicle_color: 1,
            contact_info: 1,
            additional_notes: 1,
            wait_time_minutes: 1,
            distance: 1,
            // Rename driver → driver_id to match Android ApiCarpoolPost shape
            driver_id: {
              _id: '$driver._id',
              first_name: '$driver.first_name',
              last_name: '$driver.last_name',
              average_rating: '$driver.average_rating',
              is_verified: '$driver.is_verified',
              verification_status: '$driver.verification_status'
            }
          }
        }
      ]);
      console.log('Geo search results:', posts); // Log results of geo search
    } else {
      console.log('Fetching all posts.');
      posts = await CarpoolPost.find(buildUpcomingJoinableFilter())
        .populate('driver_id', 'first_name last_name average_rating is_verified verification_status') // Populate all fields needed by app
        .sort({ departure_time: -1 }); // Sort by newest first
      console.log('All posts results:', posts); // Log results of all posts
    }

    const postUuids = posts.map((p) => p.post_id).filter(Boolean);
    const confirmedPostIds = await getConfirmedBookingPostIdsForUser(req.user.id, postUuids);
    posts = posts.map((item) => {
      const driverId = toIdString(item.driver_id);
      const isDriver = driverId === req.user.id;
      const isConfirmedPassenger = Boolean(item.post_id && confirmedPostIds.has(item.post_id));
      if (!isDriver && !isConfirmedPassenger) {
        return hideVehicleIdentity(item);
      }
      return item;
    });

    res.json(posts);
  } catch (error) {
    console.error('Error in getPosts:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};

const createPost = [
  body('start_location_name').notEmpty().withMessage('Start location name is required'),
  body('start_lat').isFloat().withMessage('Start latitude must be a number'),
  body('start_lng').isFloat().withMessage('Start longitude must be a number'),
  body('end_location_name').notEmpty().withMessage('End location name is required'),
  body('end_lat').isFloat().withMessage('End latitude must be a number'),
  body('end_lng').isFloat().withMessage('End longitude must be a number'),
  body('departure_time').isISO8601().toDate().withMessage('Departure time must be a valid date and time'),
  body('total_seats').isInt({ min: 1 }).withMessage('Total seats must be an integer greater than 0'),
  body('price_per_seat').isFloat({ min: 0 }).withMessage('Price per seat must be a number greater than or equal to 0'),
  body('vehicle_plate').isString().notEmpty().withMessage('Vehicle plate is required'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { start_lat, start_lng, end_lat, end_lng, total_seats, ...rest } = req.body;

    const existingActiveHostedRide = await CarpoolPost.findOne({
      driver_id: req.user.id,
      status: { $in: ACTIVE_HOST_RIDE_STATUSES }
    });

    if (existingActiveHostedRide) {
      return res.status(409).json({
        code: 'ACTIVE_HOST_RIDE_CONFLICT',
        message: 'You already have an active/in-progress hosted ride. Complete or cancel it before creating another.'
      });
    }

    const user = await User.findById(req.user.id).select('role is_verified verification_status');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isVerified = user.is_verified === true || VERIFIED_STATUSES.includes(user.verification_status);
    if (user.role !== 'admin' && !isVerified) {
      return res.status(403).json({
        code: 'VERIFICATION_REQUIRED',
        message: 'Only verified users can create rides. Please submit verification first.'
      });
    }

    const post = new CarpoolPost({
      post_id: uuidv4(),
      driver_id: req.user.id,
      ...rest,
      start_lat,
      start_lng,
      end_lat,
      end_lng,
      location: {
        type: 'Point',
        coordinates: [parseFloat(start_lng), parseFloat(start_lat)] // GeoJSON [longitude, latitude]
      },
      end_location: {
        type: 'Point',
        coordinates: [parseFloat(end_lng), parseFloat(end_lat)] // GeoJSON [longitude, latitude]
      },
      available_seats: total_seats,
      total_seats: total_seats
    });
    await post.save();
    const populatedPost = await CarpoolPost.findById(post._id)
      .populate('driver_id', 'first_name last_name average_rating is_verified verification_status');
    res.status(201).json(populatedPost);
  }
];

const getPost = async (req, res) => {
  const post = await CarpoolPost.findById(req.params.id)
    .populate('driver_id', 'first_name last_name average_rating is_verified verification_status');
  if (!post) return res.status(404).json({ message: 'Post not found' });

  const driverId = toIdString(post.driver_id);
  const isDriver = driverId === req.user.id;
  let isConfirmedPassenger = false;
  if (!isDriver) {
    const booking = await Booking.findOne({
      passenger_id: req.user.id,
      post_id: post.post_id,
      status: { $in: CONFIRMED_LIKE_BOOKING_STATUSES }
    }).select('_id');
    isConfirmedPassenger = Boolean(booking);
  }

  if (!isDriver && !isConfirmedPassenger) {
    hideVehicleIdentity(post);
  }
  res.json(post);
};

const getMyPosts = async (req, res) => {
  try {
    const posts = await CarpoolPost.find({ driver_id: req.user.id })
      .populate('driver_id', 'first_name last_name average_rating is_verified verification_status')
      .sort({ departure_time: -1 });
    res.json(posts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updatePostStatus = async (req, res) => {
  const { status } = req.body;
  const post = await CarpoolPost.findById(req.params.id);
  if (!post) return res.status(404).json({ message: 'Post not found' });

  if (post.driver_id.toString() !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only the ride host can update status' });
  }

  const isTransitioningToActiveHostedRide = status === 'active' || status === 'in_progress';
  if (isTransitioningToActiveHostedRide) {
    const otherActiveHostedRide = await CarpoolPost.findOne({
      _id: { $ne: post._id },
      driver_id: post.driver_id,
      status: { $in: ACTIVE_HOST_RIDE_STATUSES }
    });

    if (otherActiveHostedRide) {
      return res.status(409).json({
        code: 'ACTIVE_HOST_RIDE_CONFLICT',
        message: 'You already have another active/in-progress hosted ride. Complete or cancel it before starting a new one.'
      });
    }
  }

  if (status === 'cancelled' && req.user.role !== 'admin' && hasPassedCancellationCutoff(post.departure_time)) {
    return res.status(409).json({
      code: 'CANCEL_CUTOFF_EXCEEDED',
      message: 'Ride cancellation is not allowed within 30 minutes of departure.'
    });
  }

  post.status = status;
  await post.save();
  const participantUserIds = await getRideParticipantUserIds(post);
  const rideStatusPayload = {
    post_id: post._id.toString(),
    post_uuid: post.post_id,
    status
  };
  emitRideEvent(req, post._id.toString(), 'ride_status_changed', rideStatusPayload);
  emitRideEventToUsers(req, participantUserIds, 'ride_status_changed', rideStatusPayload);

  if (status === 'cancelled') {
    const confirmedBookings = await Booking.find({ post_id: post.post_id, status: 'confirmed' })
      .select('passenger_id')
      .lean();
    const cancelledParticipantUserIds = [
      post.driver_id?.toString(),
      ...confirmedBookings.map((item) => item.passenger_id?.toString())
    ];
    const payload = {
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      status: 'cancelled',
      cancelled_by: req.user.id
    };
    emitRideEvent(req, post._id.toString(), 'ride_cancelled', payload);
    emitRideEventToUsers(req, cancelledParticipantUserIds, 'ride_cancelled', payload);

    const notification = buildRideStatusNotification('cancelled');
    sendToUsers({
      userIds: cancelledParticipantUserIds,
      excludeUserId: req.user.id,
      notification,
      data: { type: 'ride_cancelled', ...payload }
    }).catch((error) => console.error('Push notification failed:', error.message));
  } else {
    const notification = buildRideStatusNotification(status);
    sendToUsers({
      userIds: participantUserIds,
      excludeUserId: req.user.id,
      notification,
      data: { type: 'ride_status_changed', ...rideStatusPayload }
    }).catch((error) => console.error('Push notification failed:', error.message));
  }

  if (status === 'completed') {
    // Feedback records are created when a user submits a real 1..5 rating via /feedback.
    // Do not create placeholder rows here because rating=0 violates Feedback schema.
  }
  res.json(post);
};

const startPostRide = async (req, res) => {
  try {
    const post = await CarpoolPost.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Post not found' });

    if (post.driver_id.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Only the ride host can start the ride' });
    }

    if (post.status === 'in_progress') {
      return res.json(post);
    }

    if (post.status !== 'active') {
      return res.status(400).json({ message: 'Only active rides can be started' });
    }

    const activeBookings = await Booking.find({
      post_id: post.post_id,
      status: { $in: ACTIVE_BOOKING_STATUSES }
    });
    const bookedPassengerBookings = activeBookings.filter((booking) =>
      CONFIRMED_LIKE_BOOKING_STATUSES.includes(booking.status)
    );
    const noOneBookedYet = bookedPassengerBookings.length === 0;
    const allBookedUsersBoarded = bookedPassengerBookings.every(
      (booking) => booking.pickup_status === PICKUP_STATUS_BOARDED
    );
    const canBypassWaitTimer = noOneBookedYet || allBookedUsersBoarded;

    const waitMinutes = Math.max(0, post.wait_time_minutes || 0);
    const waitUntilEpoch = new Date(post.departure_time).getTime() + (waitMinutes * 60 * 1000);
    if (
      req.user.role !== 'admin' &&
      Number.isFinite(waitUntilEpoch) &&
      Date.now() < waitUntilEpoch &&
      !canBypassWaitTimer
    ) {
      const secondsRemaining = Math.max(1, Math.ceil((waitUntilEpoch - Date.now()) / 1000));
      return res.status(409).json({
        code: 'WAIT_TIMER_ACTIVE',
        message: 'Wait timer is still active. Please wait before starting the ride.',
        wait_seconds_remaining: secondsRemaining
      });
    }
    const confirmedBookings = activeBookings.filter((booking) => booking.status === 'confirmed');
    const leftBehindBookings = [];
    const leftBehindAt = new Date();

    for (const booking of confirmedBookings) {
      if (booking.pickup_status !== PICKUP_STATUS_BOARDED) {
        booking.pickup_status = PICKUP_STATUS_LEFT_BEHIND;
        booking.left_behind_at = leftBehindAt;
        await booking.save();
        leftBehindBookings.push(booking);
      }
    }

    post.status = 'in_progress';
    await post.save();

    for (const leftBehind of leftBehindBookings) {
      emitRideEvent(req, post._id.toString(), 'passenger_left_behind', {
        booking_id: leftBehind._id.toString(),
        post_id: post._id.toString(),
        post_uuid: post.post_id,
        passenger_id: leftBehind.passenger_id.toString(),
        left_behind_at: leftBehind.left_behind_at
      });
    }

    emitRideEvent(req, post._id.toString(), 'ride_started', {
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      started_at: new Date().toISOString(),
      left_behind_count: leftBehindBookings.length
    });
    const participantUserIds = await getRideParticipantUserIds(post);
    const rideStatusPayload = {
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      status: post.status
    };
    emitRideEventToUsers(req, participantUserIds, 'ride_started', {
      post_id: post._id.toString(),
      post_uuid: post.post_id,
      started_at: new Date().toISOString(),
      left_behind_count: leftBehindBookings.length
    });
    emitRideEventToUsers(req, participantUserIds, 'ride_status_changed', rideStatusPayload);

    const notification = buildRideStatusNotification('in_progress');
    sendToUsers({
      userIds: participantUserIds,
      excludeUserId: req.user.id,
      notification,
      data: {
        type: 'ride_started',
        post_id: post._id.toString(),
        post_uuid: post.post_id,
        status: post.status,
        left_behind_count: leftBehindBookings.length
      }
    }).catch((error) => console.error('Push notification failed:', error.message));

    res.json(post);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getPosts, createPost, getPost, updatePostStatus, startPostRide, getMyPosts };
