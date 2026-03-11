const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  booking_id: { type: String, unique: true, required: true },
  post_id: { type: String, ref: 'CarpoolPost', required: true },
  passenger_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  seats_booked: { type: Number, default: 1, required: true },
  status: { 
    type: String, 
    enum: ['pending', 'accepted', 'rejected', 'confirmed', 'waitlisted', 'cancelled'], 
    default: 'pending',
    required: true 
  },
  pickup_status: {
    type: String,
    enum: ['not_arrived', 'arrived', 'boarded', 'left_behind'],
    default: 'not_arrived',
    required: true
  },
  arrived_at: { type: Date, default: null },
  confirmed_by_driver_at: { type: Date, default: null },
  left_behind_at: { type: Date, default: null },
  booked_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', bookingSchema);
