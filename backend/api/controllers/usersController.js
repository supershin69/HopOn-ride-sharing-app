const User = require('../models/User');
const Feedback = require('../models/Feedback');
const VerificationRequest = require('../models/VerificationRequest');
const { body, validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');

const getUser = async (req, res) => {
  const user = await User.findById(req.params.id).select('-password_hash');
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json(user);
};

const updateUser = [
  body('first_name').optional().notEmpty(),
  body('last_name').optional().notEmpty(),
  body('email').optional().isEmail(),
  body('profile_photo').optional({ checkFalsy: true }).isString(),
  body('password').optional({ checkFalsy: true }).isLength({ min: 6 }),
  body('current_password').optional({ checkFalsy: true }).isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const canUpdateTargetUser = req.user?.id === req.params.id || req.user?.role === 'admin';
      if (!canUpdateTargetUser) {
        return res.status(403).json({ message: 'You can only update your own profile' });
      }

      const user = await User.findById(req.params.id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const {
        first_name,
        last_name,
        email,
        profile_photo: profilePhoto,
        password: newPassword,
        current_password: currentPassword,
      } = req.body;

      // 1) Validate email uniqueness before mutating document
      if (typeof email === 'string' && email.trim() !== '' && email !== user.email) {
        const existing = await User.findOne({ email: email.trim() });
        if (existing && existing._id.toString() !== user._id.toString()) {
          return res.status(400).json({ message: 'Email already in use' });
        }
      }

      // 2) Build change intent and enforce security policy:
      //    any profile update requires current_password;
      //    new password remains optional.
      const hasNewPassword = typeof newPassword === 'string' && newPassword.trim() !== '';
      const hasCurrentPassword = typeof currentPassword === 'string' && currentPassword.trim() !== '';
      const nextFirstName =
        typeof first_name === 'string' ? first_name.trim() : undefined;
      const nextLastName =
        typeof last_name === 'string' ? last_name.trim() : undefined;
      const nextEmail =
        typeof email === 'string' && email.trim() !== '' ? email.trim() : undefined;
      const nextProfilePhoto =
        typeof profilePhoto === 'string' ? profilePhoto.trim() : undefined;

      const hasProfileChange =
        (nextFirstName !== undefined && nextFirstName !== user.first_name) ||
        (nextLastName !== undefined && nextLastName !== user.last_name) ||
        (nextEmail !== undefined && nextEmail !== user.email) ||
        (nextProfilePhoto !== undefined && nextProfilePhoto !== (user.profile_photo || null));

      if (!hasProfileChange && !hasNewPassword) {
        return res.status(400).json({ message: 'No changes to update' });
      }

      if (!hasCurrentPassword) {
        return res.status(400).json({
          message: 'Current password is required to update profile',
        });
      }

      const isCurrentValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isCurrentValid) {
        return res.status(400).json({ message: 'Current password is incorrect' });
      }

      if (hasNewPassword) {
        if (currentPassword === newPassword) {
          return res.status(400).json({
            message: 'New password must be different from current password',
          });
        }
      }

      // 3) Apply changes only after all validations pass (all-or-nothing behavior)
      if (nextFirstName !== undefined) user.first_name = nextFirstName;
      if (nextLastName !== undefined) user.last_name = nextLastName;
      if (nextEmail !== undefined) user.email = nextEmail;
      if (nextProfilePhoto !== undefined) user.profile_photo = nextProfilePhoto || null;
      if (hasNewPassword) user.password_hash = newPassword;
      user.updated_at = new Date();

      await user.save();
      const safeUser = user.toObject();
      delete safeUser.password_hash;

      res.json(safeUser);
    } catch (error) {
      if (error && error.code === 11000 && error.keyPattern?.email) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      res.status(500).json({ message: 'Failed to update user', error: error.message });
    }
  }
];

const getUserFeedback = async (req, res) => {
  const feedback = await Feedback.find({ reviewee_id: req.params.id });
  res.json(feedback);
};

const submitMyVerification = [
  body('verification_type').isIn(['national_id', 'student_id']),
  body('verification_doc_url').isString().notEmpty(),
  body('verification_notes').optional({ nullable: true }).isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const { verification_type, verification_doc_url, verification_notes } = req.body;
      const verificationRequest = await VerificationRequest.create({
        user_id: user._id,
        verification_type,
        verification_doc_url,
        verification_notes: verification_notes || null,
        status: 'pending'
      });
      user.verification_type = verification_type;
      user.verification_doc_url = verification_doc_url;
      user.verification_notes = verification_notes || null;
      user.verification_status = 'pending';
      user.is_verified = false;
      user.verified_at = null;
      user.updated_at = new Date();

      await user.save();
      const io = req.app.get('io');
      const requestPayload = await VerificationRequest.findById(verificationRequest._id)
        .populate('user_id', 'first_name last_name email role verification_status')
        .lean();
      if (io && requestPayload) {
        io.to('admin').emit('verification_created', requestPayload);
        io.to(`user_${user._id.toString()}`).emit('verification_updated', requestPayload);
      }
      return res.status(200).json({
        request_id: verificationRequest.request_id,
        verification_status: user.verification_status,
        verification_type: user.verification_type,
        verification_doc_url: user.verification_doc_url,
        verification_notes: user.verification_notes,
        verified_at: user.verified_at
      });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to submit verification', error: error.message });
    }
  }
];

const getMyVerification = async (req, res) => {
  try {
    const [user, latestRequest] = await Promise.all([
      User.findById(req.user.id).select(
        'verification_status verification_type verification_doc_url verification_notes verified_at is_verified'
      ),
      VerificationRequest.findOne({ user_id: req.user.id }).sort({ created_at: -1 }).lean()
    ]);
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({
      request_id: latestRequest?.request_id || null,
      request_status: latestRequest?.status || null,
      verification_status: user.verification_status || (user.is_verified ? 'verified' : 'unverified'),
      verification_type: user.verification_type || latestRequest?.verification_type || null,
      verification_doc_url: user.verification_doc_url || latestRequest?.verification_doc_url || null,
      verification_notes: user.verification_notes || latestRequest?.verification_notes || null,
      verified_at: user.verified_at || null
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to fetch verification', error: error.message });
  }
};

const registerPushToken = [
  body('token').isString().notEmpty(),
  body('platform').optional().isIn(['android', 'ios', 'web']),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const token = String(req.body.token).trim();
      const existingTokens = Array.isArray(user.fcm_tokens) ? user.fcm_tokens : [];
      const nextTokens = [token, ...existingTokens.filter((item) => item !== token)].slice(0, 5);
      user.fcm_tokens = nextTokens;
      user.updated_at = new Date();
      await user.save();

      return res.json({ message: 'Push token registered' });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to register push token', error: error.message });
    }
  }
];

const removePushToken = [
  body('token').isString().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User not found' });

      const token = String(req.body.token).trim();
      user.fcm_tokens = (user.fcm_tokens || []).filter((item) => item !== token);
      user.updated_at = new Date();
      await user.save();

      return res.json({ message: 'Push token removed' });
    } catch (error) {
      return res.status(500).json({ message: 'Failed to remove push token', error: error.message });
    }
  }
];

module.exports = {
  getUser,
  updateUser,
  getUserFeedback,
  submitMyVerification,
  getMyVerification,
  registerPushToken,
  removePushToken
};
