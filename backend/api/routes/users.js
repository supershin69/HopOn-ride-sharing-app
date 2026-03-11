const express = require('express');
const router = express.Router();
const {
  getUser,
  updateUser,
  getUserFeedback,
  submitMyVerification,
  getMyVerification,
  registerPushToken,
  removePushToken
} = require('../controllers/usersController');

router.post('/me/verification', submitMyVerification);
router.get('/me/verification', getMyVerification);
router.post('/me/push-token', registerPushToken);
router.delete('/me/push-token', removePushToken);
router.get('/:id', getUser);
router.put('/:id', updateUser);
router.get('/:id/feedback', getUserFeedback);

module.exports = router;
