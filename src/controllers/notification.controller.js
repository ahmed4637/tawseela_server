const mongoose = require('mongoose');

const Account = require('../models/account.model');
const Notification = require('../models/notification.model');
const DeviceToken = require('../models/deviceToken.model');
const NotificationTemplate = require('../models/notificationTemplate.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const {
  createNotification,
  registerDeviceToken,
  deactivateDeviceToken,
} = require('../services/notification.service');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id?.toString() || '');

const buildPagination = ({ page = 1, limit = 30, total = 0 }) => {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);

  return {
    pageNumber,
    limitNumber,
    skip: (pageNumber - 1) * limitNumber,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  };
};

const getMyNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly, page = 1, limit = 30, type } = req.query;

  const query = {
    accountId: req.accountId,
  };

  if (unreadOnly === 'true') {
    query.isRead = false;
  }

  if (type) {
    query.type = type;
  }

  const total = await Notification.countDocuments(query);
  const { pageNumber, limitNumber, skip, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const [docs, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),

    Notification.countDocuments({
      accountId: req.accountId,
      isRead: false,
    }),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب الإشعارات بنجاح',
    docs,
    extra: {
      unreadCount,
      pagination: {
        ...pagination,
        page: pageNumber,
        limit: limitNumber,
      },
    },
  });
});

const markNotificationAsRead = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const doc = await Notification.findOneAndUpdate(
    {
      _id: id,
      accountId: req.accountId,
    },
    {
      isRead: true,
      readAt: new Date(),
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!doc) {
    const error = new Error('الإشعار غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم تعليم الإشعار كمقروء',
    doc,
  });
});

const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany(
    {
      accountId: req.accountId,
      isRead: false,
    },
    {
      isRead: true,
      readAt: new Date(),
    }
  );

  return sendSuccess({
    res,
    message: 'تم تعليم كل الإشعارات كمقروءة',
  });
});

const registerMyDeviceToken = asyncHandler(async (req, res) => {
  const { token, platform, deviceId, appVersion, locale } = req.body;

  const doc = await registerDeviceToken({
    accountId: req.accountId,
    token,
    platform,
    deviceId,
    appVersion,
    locale,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم تسجيل جهاز الإشعارات بنجاح',
    doc,
  });
});

const deactivateMyDeviceToken = asyncHandler(async (req, res) => {
  const { token, deviceId } = req.body;

  const result = await deactivateDeviceToken({
    accountId: req.accountId,
    token,
    deviceId,
  });

  return sendSuccess({
    res,
    message: 'تم تعطيل جهاز الإشعارات بنجاح',
    doc: {
      modifiedCount: result.modifiedCount || 0,
    },
  });
});

const getMyDeviceTokens = asyncHandler(async (req, res) => {
  const docs = await DeviceToken.find({ accountId: req.accountId })
    .select('-token')
    .sort({ lastUsedAt: -1 });

  return sendSuccess({
    res,
    message: 'تم جلب أجهزة الإشعارات بنجاح',
    docs,
  });
});

const getAdminNotificationTemplates = asyncHandler(async (req, res) => {
  const { targetType, isActive } = req.query;

  const query = {};

  if (targetType) {
    query.targetType = targetType;
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const docs = await NotificationTemplate.find(query).sort({ key: 1 });

  return sendSuccess({
    res,
    message: 'تم جلب قوالب الإشعارات بنجاح',
    docs,
  });
});

const createAdminNotificationTemplate = asyncHandler(async (req, res) => {
  const body = req.body;

  const doc = await NotificationTemplate.create({
    key: body.key,
    titleAr: body.titleAr,
    bodyAr: body.bodyAr,
    titleEn: body.titleEn || '',
    bodyEn: body.bodyEn || '',
    targetType: body.targetType || 'all',
    type: body.type || 'general',
    isActive: body.isActive !== false,
    updatedBy: req.accountId,
  });

  await createAdminAuditLog({
    req,
    module: 'notifications',
    action: 'create_template',
    entityType: 'NotificationTemplate',
    entityId: doc._id,
    oldValue: null,
    newValue: doc,
    reason: body.reason || '',
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء قالب الإشعار بنجاح',
    doc,
  });
});

const updateAdminNotificationTemplate = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const oldDoc = await NotificationTemplate.findById(id);

  if (!oldDoc) {
    const error = new Error('قالب الإشعار غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const allowedFields = [
    'titleAr',
    'bodyAr',
    'titleEn',
    'bodyEn',
    'targetType',
    'type',
    'isActive',
  ];

  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      oldDoc[field] = req.body[field];
    }
  });

  oldDoc.updatedBy = req.accountId;

  const before = oldDoc.toObject();
  await oldDoc.save();

  await createAdminAuditLog({
    req,
    module: 'notifications',
    action: 'update_template',
    entityType: 'NotificationTemplate',
    entityId: oldDoc._id,
    oldValue: before,
    newValue: oldDoc,
    reason: req.body.reason || '',
  });

  return sendSuccess({
    res,
    message: 'تم تحديث قالب الإشعار بنجاح',
    doc: oldDoc,
  });
});

const getAdminNotifications = asyncHandler(async (req, res) => {
  const { accountId, type, pushStatus, page = 1, limit = 30 } = req.query;

  const query = {};

  if (accountId && isValidObjectId(accountId)) {
    query.accountId = accountId;
  }

  if (type) {
    query.type = type;
  }

  if (pushStatus) {
    query.pushStatus = pushStatus;
  }

  const total = await Notification.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await Notification.find(query)
    .populate('accountId', 'name phone roles defaultRole')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل الإشعارات بنجاح',
    docs,
    extra: { pagination },
  });
});

const getAdminDeviceTokens = asyncHandler(async (req, res) => {
  const { accountId, platform, isActive, page = 1, limit = 30 } = req.query;

  const query = {};

  if (accountId && isValidObjectId(accountId)) {
    query.accountId = accountId;
  }

  if (platform) {
    query.platform = platform;
  }

  if (isActive === 'true') {
    query.isActive = true;
  }

  if (isActive === 'false') {
    query.isActive = false;
  }

  const total = await DeviceToken.countDocuments(query);
  const { limitNumber, skip, pagination } = buildPagination({ page, limit, total });

  const docs = await DeviceToken.find(query)
    .select('-token')
    .populate('accountId', 'name phone roles defaultRole')
    .sort({ lastUsedAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب أجهزة الإشعارات بنجاح',
    docs,
    extra: { pagination },
  });
});

const sendAdminNotification = asyncHandler(async (req, res) => {
  const {
    accountId,
    role,
    title,
    body,
    type = 'admin',
    data = {},
    templateKey = '',
    sendPush = true,
    reason = '',
  } = req.body;

  let recipients = [];

  if (accountId) {
    if (!isValidObjectId(accountId)) {
      const error = new Error('رقم الحساب غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    recipients = [accountId];
  } else if (role) {
    const accounts = await Account.find({
      roles: role,
      isActive: true,
    }).select('_id');

    recipients = accounts.map((account) => account._id);
  } else {
    const error = new Error('حدد حساب واحد أو نوع مستخدم للإرسال');
    error.statusCode = 400;
    throw error;
  }

  const created = [];

  for (const recipientId of recipients) {
    const notification = await createNotification({
      accountId: recipientId,
      title,
      body,
      type,
      data,
      templateKey,
      sendPush: sendPush !== false,
    });

    created.push(notification);
  }

  await createAdminAuditLog({
    req,
    module: 'notifications',
    action: 'send_notification',
    entityType: 'Notification',
    entityId: created[0]?._id || null,
    oldValue: null,
    newValue: {
      recipientsCount: recipients.length,
      accountId: accountId || null,
      role: role || null,
      title,
      body,
      type,
      templateKey,
    },
    reason,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال الإشعار بنجاح',
    docs: created,
    extra: {
      recipientsCount: recipients.length,
    },
  });
});

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  registerMyDeviceToken,
  deactivateMyDeviceToken,
  getMyDeviceTokens,
  getAdminNotificationTemplates,
  createAdminNotificationTemplate,
  updateAdminNotificationTemplate,
  getAdminNotifications,
  getAdminDeviceTokens,
  sendAdminNotification,
};
