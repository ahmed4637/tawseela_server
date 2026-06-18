const Notification = require('../models/notification.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const getMyNotifications = asyncHandler(async (req, res) => {
  const { unreadOnly, page = 1, limit = 30 } = req.query;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const query = {
    accountId: req.accountId,
  };

  if (unreadOnly === 'true') {
    query.isRead = false;
  }

  const [docs, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNumber),

    Notification.countDocuments(query),

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
        page: pageNumber,
        limit: limitNumber,
        total,
        pages: Math.ceil(total / limitNumber),
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

module.exports = {
  getMyNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};