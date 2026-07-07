const Notification = require('../models/notification.model');
const DeviceToken = require('../models/deviceToken.model');
const NotificationTemplate = require('../models/notificationTemplate.model');
const fs = require('fs');
const path = require('path');

const { emitToAccount } = require('../sockets/socket.server');

let firebaseAppInitialized = false;
let firebaseAdmin = null;
let firebaseInitError = null;

const normalizeNotificationType = (type = 'general') => {
  const allowedTypes = [
    'general',
    'request',
    'offer',
    'negotiation',
    'trip',
    'chat',
    'payment',
    'promo',
    'loyalty',
    'penalty',
    'complaint',
    'review',
    'scheduled_reminder',
    'admin',
  ];

  return allowedTypes.includes(type) ? type : 'general';
};

const getFirebaseAdmin = () => {
  if (firebaseAppInitialized) {
    return firebaseAdmin;
  }

  firebaseAppInitialized = true;

  try {
    // firebase-admin is loaded lazily so the API does not crash before FCM credentials are configured.
    // Production deployment must install firebase-admin and provide service account credentials.
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    firebaseAdmin = require('firebase-admin');

    if (firebaseAdmin.apps && firebaseAdmin.apps.length > 0) {
      return firebaseAdmin;
    }

    let credential = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      const serviceAccountPath = path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      if (!fs.existsSync(serviceAccountPath)) {
        firebaseInitError = `Firebase service account file not found: ${serviceAccountPath}`;
        firebaseAdmin = null;
        return null;
      }

      // eslint-disable-next-line import/no-dynamic-require, global-require
      const serviceAccount = require(serviceAccountPath);
      credential = firebaseAdmin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      credential = firebaseAdmin.credential.cert(serviceAccount);
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      credential = firebaseAdmin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    }

    if (!credential) {
      firebaseInitError = 'FCM credentials are not configured';
      firebaseAdmin = null;
      return null;
    }

    firebaseAdmin.initializeApp({
      credential,
      projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    });
    return firebaseAdmin;
  } catch (error) {
    firebaseInitError = error.message;
    firebaseAdmin = null;
    return null;
  }
};

const stringifyPushData = (data = {}) => {
  const result = {};

  Object.entries(data || {}).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (typeof value === 'string') {
      result[key] = value;
      return;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value.toString();
      return;
    }

    try {
      result[key] = JSON.stringify(value);
    } catch (error) {
      result[key] = String(value);
    }
  });

  return result;
};

const getActiveTokensForAccount = async (accountId) => {
  return DeviceToken.find({
    accountId,
    isActive: true,
  }).sort({ lastUsedAt: -1 });
};

const markInvalidTokensInactive = async (tokens = []) => {
  if (!tokens.length) {
    return;
  }

  await DeviceToken.updateMany(
    { token: { $in: tokens } },
    {
      isActive: false,
      disabledReason: 'invalid_fcm_token',
    }
  );
};

const sendPushToAccount = async ({ accountId, title, body, data = {} }) => {
  const admin = getFirebaseAdmin();

  if (!admin) {
    return {
      status: 'skipped',
      successCount: 0,
      failureCount: 0,
      failedTokens: [],
      errorMessage: firebaseInitError || 'FCM is not configured',
    };
  }

  const deviceTokens = await getActiveTokensForAccount(accountId);
  const tokens = deviceTokens.map((item) => item.token).filter(Boolean);

  if (!tokens.length) {
    return {
      status: 'skipped',
      successCount: 0,
      failureCount: 0,
      failedTokens: [],
      errorMessage: 'No active device tokens',
    };
  }

  const message = {
    tokens,
    notification: {
      title,
      body,
    },
    data: stringifyPushData({
      ...data,
      title,
      body,
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    }),
    android: {
      priority: 'high',
      ttl: 60 * 60 * 1000,
      notification: {
        sound: 'default',
        channelId: 'tawseela_general',
        clickAction: 'FLUTTER_NOTIFICATION_CLICK',
        tag: data?.serviceRequestId?.toString() || data?.notificationId?.toString() || undefined,
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          contentAvailable: true,
        },
      },
    },
  };

  try {
    const response = typeof admin.messaging().sendEachForMulticast === 'function'
      ? await admin.messaging().sendEachForMulticast(message)
      : await admin.messaging().sendMulticast(message);

    const invalidTokens = [];
    const failedTokens = [];

    response.responses.forEach((item, index) => {
      if (item.success) {
        return;
      }

      const token = tokens[index];
      failedTokens.push(token);

      const code = item.error?.code || '';
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-registration-token') ||
        code.includes('invalid-argument')
      ) {
        invalidTokens.push(token);
      }
    });

    await markInvalidTokensInactive(invalidTokens);

    const status = response.failureCount === 0
      ? 'sent'
      : response.successCount > 0
        ? 'partial'
        : 'failed';

    return {
      status,
      successCount: response.successCount,
      failureCount: response.failureCount,
      failedTokens,
      errorMessage: response.failureCount > 0 ? 'Some push messages failed' : '',
    };
  } catch (error) {
    return {
      status: 'failed',
      successCount: 0,
      failureCount: tokens.length,
      failedTokens: tokens,
      errorMessage: error.message,
    };
  }
};

const emitNotificationSocket = ({ accountId, notification }) => {
  try {
    emitToAccount(accountId.toString(), 'notification:new', {
      notification,
    });
  } catch (error) {
    console.error('Notification socket error:', error.message);
  }
};

const createNotification = async ({
  accountId,
  title,
  body,
  type = 'general',
  data = {},
  templateKey = '',
  sendPush = true,
}) => {
  const notification = await Notification.create({
    accountId,
    title,
    body,
    type: normalizeNotificationType(type),
    data,
    templateKey,
    pushStatus: sendPush ? 'pending' : 'not_requested',
  });

  emitNotificationSocket({ accountId, notification });

  if (!sendPush) {
    return notification;
  }

  const pushResult = await sendPushToAccount({
    accountId,
    title,
    body,
    data: {
      ...data,
      notificationId: notification._id.toString(),
      notificationType: normalizeNotificationType(type),
      templateKey: templateKey || '',
    },
  });

  notification.pushStatus = pushResult.status;
  notification.pushSentAt = ['sent', 'partial', 'failed'].includes(pushResult.status)
    ? new Date()
    : null;
  notification.pushResult = {
    successCount: pushResult.successCount,
    failureCount: pushResult.failureCount,
    failedTokens: pushResult.failedTokens,
    errorMessage: pushResult.errorMessage,
  };

  await notification.save();

  return notification;
};

const createNotificationFromTemplate = async ({
  accountId,
  templateKey,
  data = {},
  fallbackTitle = '',
  fallbackBody = '',
  sendPush = true,
}) => {
  const cleanKey = templateKey.toString().trim().toLowerCase();

  const template = cleanKey
    ? await NotificationTemplate.findOne({ key: cleanKey, isActive: true })
    : null;

  const title = template?.titleAr || fallbackTitle;
  const body = template?.bodyAr || fallbackBody;

  if (!title || !body) {
    const error = new Error('قالب الإشعار غير موجود أو بيانات الإشعار ناقصة');
    error.statusCode = 400;
    throw error;
  }

  return createNotification({
    accountId,
    title,
    body,
    type: template?.type || 'general',
    data,
    templateKey: cleanKey,
    sendPush,
  });
};

const createManyNotifications = async (items = []) => {
  const created = [];

  for (const item of items) {
    const notification = await createNotification(item);
    created.push(notification);
  }

  return created;
};

const registerDeviceToken = async ({
  accountId,
  token,
  platform,
  deviceId = '',
  appVersion = '',
  locale = 'ar',
}) => {
  const cleanToken = token.toString().trim();
  const cleanDeviceId = deviceId ? deviceId.toString().trim() : '';

  const doc = await DeviceToken.findOneAndUpdate(
    { token: cleanToken },
    {
      accountId,
      token: cleanToken,
      platform,
      deviceId: cleanDeviceId,
      appVersion: appVersion || '',
      locale: locale || 'ar',
      isActive: true,
      disabledReason: '',
      lastUsedAt: new Date(),
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  if (cleanDeviceId) {
    await DeviceToken.updateMany(
      {
        accountId,
        deviceId: cleanDeviceId,
        _id: { $ne: doc._id },
      },
      {
        isActive: false,
        disabledReason: 'replaced_by_new_token',
      }
    );
  }

  return doc;
};

const deactivateDeviceToken = async ({ accountId, token, deviceId = '' }) => {
  const query = { accountId };

  if (token) {
    query.token = token.toString().trim();
  } else if (deviceId) {
    query.deviceId = deviceId.toString().trim();
  } else {
    const error = new Error('Token أو deviceId مطلوب');
    error.statusCode = 400;
    throw error;
  }

  const result = await DeviceToken.updateMany(query, {
    isActive: false,
    disabledReason: 'logout',
  });

  return result;
};

module.exports = {
  createNotification,
  createNotificationFromTemplate,
  createManyNotifications,
  registerDeviceToken,
  deactivateDeviceToken,
  sendPushToAccount,
  getFirebaseAdmin,
};
