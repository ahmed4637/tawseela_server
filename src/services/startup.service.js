const mongoose = require('mongoose');

const AppSettings = require('../models/appSettings.model');
const NotificationTemplate = require('../models/notificationTemplate.model');
const { ensureDefaultAdminRoles } = require('./adminAccess.service');
const { getAppSettings } = require('./appSettings.service');

const REQUIRED_ENV_GROUPS = [
  {
    name: 'MongoDB connection',
    keys: ['MONGO_URI', 'DB_URI'],
    anyOf: true,
  },
  {
    name: 'JWT secret',
    keys: ['JWT_SECRET'],
    anyOf: false,
  },
];

const OPTIONAL_ENV_GROUPS = [
  {
    name: 'Firebase push notifications',
    keys: [
      'FIREBASE_SERVICE_ACCOUNT_JSON',
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
    ],
    anyOf: true,
  },
  {
    name: 'Public API URL',
    keys: ['PUBLIC_API_URL', 'BASE_URL'],
    anyOf: true,
  },
];

const DEFAULT_NOTIFICATION_TEMPLATES = [
  {
    key: 'request_available',
    titleAr: 'طلب جديد متاح',
    bodyAr: 'يوجد طلب مناسب قريب منك',
    titleEn: 'New request available',
    bodyEn: 'A suitable nearby request is available.',
    targetType: 'driver',
    type: 'request',
  },
  {
    key: 'offer_received',
    titleAr: 'وصل عرض جديد',
    bodyAr: 'وصل عرض جديد على طلبك',
    titleEn: 'New offer received',
    bodyEn: 'You received a new offer for your request.',
    targetType: 'customer',
    type: 'offer',
  },
  {
    key: 'offer_accepted',
    titleAr: 'تم قبول العرض',
    bodyAr: 'تم قبول العرض وفتح الشات داخل التطبيق',
    titleEn: 'Offer accepted',
    bodyEn: 'The offer has been accepted and chat is now available.',
    targetType: 'all',
    type: 'trip',
  },
  {
    key: 'negotiation_countered',
    titleAr: 'تحديث في التفاوض',
    bodyAr: 'وصل سعر جديد في التفاوض على الطلب',
    titleEn: 'Negotiation update',
    bodyEn: 'A new price update was sent for the request.',
    targetType: 'all',
    type: 'negotiation',
  },
  {
    key: 'chat_message',
    titleAr: 'رسالة جديدة',
    bodyAr: 'وصلتك رسالة جديدة داخل الطلب',
    titleEn: 'New message',
    bodyEn: 'You have a new in-request chat message.',
    targetType: 'all',
    type: 'chat',
  },
  {
    key: 'trip_status_updated',
    titleAr: 'تحديث حالة الرحلة',
    bodyAr: 'تم تحديث حالة رحلتك',
    titleEn: 'Trip status updated',
    bodyEn: 'Your trip status has been updated.',
    targetType: 'all',
    type: 'trip',
  },
  {
    key: 'scheduled_ride_reminder',
    titleAr: 'تذكير بالحجز',
    bodyAr: 'لديك حجز بموعد قريب داخل تطبيق توصيلة',
    titleEn: 'Scheduled ride reminder',
    bodyEn: 'You have an upcoming scheduled booking in Tawseela.',
    targetType: 'all',
    type: 'scheduled_reminder',
  },
  {
    key: 'penalty_applied',
    titleAr: 'تم تطبيق إجراء على الحساب',
    bodyAr: 'تم تطبيق إجراء حسب سياسة التطبيق',
    titleEn: 'Account action applied',
    bodyEn: 'An account action was applied according to app policy.',
    targetType: 'all',
    type: 'penalty',
  },
  {
    key: 'driver_review_updated',
    titleAr: 'تحديث مراجعة السائق',
    bodyAr: 'تم تحديث حالة مراجعة حسابك أو مركبتك',
    titleEn: 'Driver review updated',
    bodyEn: 'Your driver or vehicle review status has been updated.',
    targetType: 'driver',
    type: 'review',
  },
  {
    key: 'support_updated',
    titleAr: 'تحديث من الدعم',
    bodyAr: 'يوجد تحديث جديد في تذكرة الدعم',
    titleEn: 'Support update',
    bodyEn: 'There is a new update in your support ticket.',
    targetType: 'all',
    type: 'complaint',
  },
  {
    key: 'finance_updated',
    titleAr: 'تحديث الحسابات',
    bodyAr: 'تم تحديث حساباتك المالية داخل توصيلة',
    titleEn: 'Finance update',
    bodyEn: 'Your Tawseela finance account has been updated.',
    targetType: 'driver',
    type: 'payment',
  },
];

const isEnvGroupConfigured = (group) => {
  if (group.anyOf) {
    return group.keys.some((key) => Boolean(process.env[key]));
  }

  return group.keys.every((key) => Boolean(process.env[key]));
};

const validateEnvironment = () => {
  const missingRequired = REQUIRED_ENV_GROUPS
    .filter((group) => !isEnvGroupConfigured(group))
    .map((group) => `${group.name}: ${group.keys.join(group.anyOf ? ' أو ' : ' و ')}`);

  const missingOptional = OPTIONAL_ENV_GROUPS
    .filter((group) => !isEnvGroupConfigured(group))
    .map((group) => group.name);

  const result = {
    ok: missingRequired.length === 0,
    missingRequired,
    missingOptional,
  };

  if (!result.ok && process.env.NODE_ENV === 'production') {
    const error = new Error(`Production environment is missing: ${missingRequired.join(' | ')}`);
    error.statusCode = 500;
    throw error;
  }

  if (missingRequired.length > 0) {
    console.warn('Startup required environment warnings:', missingRequired);
  }

  if (missingOptional.length > 0) {
    console.warn('Startup optional environment warnings:', missingOptional);
  }

  return result;
};

const ensureDefaultNotificationTemplates = async () => {
  const docs = [];

  for (const template of DEFAULT_NOTIFICATION_TEMPLATES) {
    const doc = await NotificationTemplate.findOneAndUpdate(
      { key: template.key },
      {
        $setOnInsert: template,
        $set: {
          targetType: template.targetType,
          type: template.type,
          isActive: true,
        },
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );

    docs.push(doc);
  }

  return docs;
};

const runStartupReadinessChecks = async () => {
  const env = validateEnvironment();

  const settings = await getAppSettings();
  const adminRoles = await ensureDefaultAdminRoles();
  const notificationTemplates = await ensureDefaultNotificationTemplates();

  return {
    env,
    database: {
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
    },
    defaults: {
      settingsId: settings?._id,
      adminRolesCount: adminRoles.length,
      notificationTemplatesCount: notificationTemplates.length,
    },
  };
};

const getReadinessSnapshot = async () => {
  const settingsExists = Boolean(await AppSettings.exists({ key: 'main' }));
  const notificationTemplatesCount = await NotificationTemplate.countDocuments({ isActive: true });

  return {
    status: mongoose.connection.readyState === 1 && settingsExists ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    database: {
      readyState: mongoose.connection.readyState,
      readyStateName: ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] || 'unknown',
      host: mongoose.connection.host || '',
      name: mongoose.connection.name || '',
    },
    defaults: {
      appSettings: settingsExists,
      notificationTemplatesCount,
    },
    environment: validateEnvironment(),
  };
};

module.exports = {
  DEFAULT_NOTIFICATION_TEMPLATES,
  validateEnvironment,
  ensureDefaultNotificationTemplates,
  runStartupReadinessChecks,
  getReadinessSnapshot,
};
