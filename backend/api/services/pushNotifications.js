const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');

let firebaseApp = null;
let initAttempted = false;

const loadServiceAccount = () => {
  const raw = process.env.FCM_SERVICE_ACCOUNT;
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }
    const resolvedPath = path.resolve(trimmed);
    const fileContents = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(fileContents);
  } catch (error) {
    console.error('FCM service account load failed:', error.message);
    return null;
  }
};

const getMessaging = () => {
  if (firebaseApp) return admin.messaging();
  if (initAttempted) return null;
  initAttempted = true;

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return null;

  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  return admin.messaging();
};

const normalizeData = (data) => {
  if (!data || typeof data !== 'object') return {};
  return Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {});
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const isInvalidTokenError = (code) => (
  code === 'messaging/registration-token-not-registered'
  || code === 'messaging/invalid-registration-token'
  || code === 'messaging/invalid-argument'
);

const sendToUsers = async ({ userIds, notification, data, excludeUserId } = {}) => {
  const messaging = getMessaging();
  if (!messaging) return { skipped: true, reason: 'messaging_not_initialized' };

  const exclude = excludeUserId ? String(excludeUserId) : null;
  const ids = [...new Set((userIds || [])
    .filter(Boolean)
    .map((id) => String(id))
    .filter((id) => !exclude || id !== exclude)
  )];

  if (ids.length === 0) return { skipped: true, reason: 'no_recipients' };

  const users = await User.find({ _id: { $in: ids } })
    .select('_id fcm_tokens')
    .lean();

  const tokenEntries = [];
  users.forEach((user) => {
    const tokens = Array.isArray(user.fcm_tokens) ? user.fcm_tokens : [];
    tokens.filter(Boolean).forEach((token) => {
      tokenEntries.push({ token, userId: user._id.toString() });
    });
  });

  if (tokenEntries.length === 0) return { skipped: true, reason: 'no_tokens' };

  const dataPayload = normalizeData(data);
  const chunks = chunkArray(tokenEntries, 500);
  const invalidTokensByUser = new Map();

  for (const chunk of chunks) {
    const tokens = chunk.map((entry) => entry.token);
    try {
      const response = await messaging.sendEachForMulticast({
        tokens,
        notification,
        data: dataPayload,
        android: { priority: 'high' }
      });

      response.responses.forEach((result, index) => {
        if (result.success) return;
        const errorCode = result.error?.code;
        if (!isInvalidTokenError(errorCode)) return;

        const entry = chunk[index];
        if (!entry) return;
        const existing = invalidTokensByUser.get(entry.userId) || new Set();
        existing.add(entry.token);
        invalidTokensByUser.set(entry.userId, existing);
      });
    } catch (error) {
      console.error('FCM send error:', error.message);
    }
  }

  if (invalidTokensByUser.size > 0) {
    const updates = [];
    invalidTokensByUser.forEach((tokens, userId) => {
      updates.push(User.updateOne(
        { _id: userId },
        { $pull: { fcm_tokens: { $in: Array.from(tokens) } } }
      ));
    });
    await Promise.allSettled(updates);
  }

  return { sent: tokenEntries.length };
};

module.exports = {
  sendToUsers
};
