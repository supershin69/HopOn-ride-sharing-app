const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  user_id: { type: String, unique: true, required: true },
  first_name: { type: String, required: true },
  last_name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  dob: { type: Date, required: true },
  password_hash: { type: String, required: true },
  phone_number: { type: String, required: true },
  profile_photo: { type: String, default: null },
  role: { type: String, enum: ['rider', 'driver', 'admin'], required: true },
  average_rating: { type: Number, default: 0 },
  is_verified: { type: Boolean, default: false },
  verification_status: {
    type: String,
    enum: ['unverified', 'pending', 'verified', 'rejected'],
    default: 'unverified'
  },
  verification_type: {
    type: String,
    enum: ['national_id', 'student_id'],
    default: null
  },
  verification_doc_url: { type: String, default: null },
  verification_notes: { type: String, default: null },
  verified_at: { type: Date, default: null },
  is_banned: { type: Boolean, default: false },
  fcm_tokens: { type: [String], default: [] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});

// NEW & WORKING
userSchema.pre('save', async function() {
  // If not modified, just return (no next needed for async)
  if (!this.isModified('password_hash')) return;

  this.password_hash = await bcrypt.hash(this.password_hash, 10);
});

module.exports = mongoose.model('User', userSchema);

