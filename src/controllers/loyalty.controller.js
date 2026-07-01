const mongoose = require('mongoose');

const Account = require('../models/account.model');
const AppSettings = require('../models/appSettings.model');
const LoyaltyAccount = require('../models/loyaltyAccount.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { getAppSettings } = require('../services/appSettings.service');
const { createAdminAuditLog } = require('../services/adminAuditLog.service');
const {
  DEFAULT_LOYALTY_SETTINGS,
  getLoyaltySettings,
  getOrCreateLoyaltyAccount,
  adminAdjustLoyaltyPoints,
} = require('../services/loyalty.service');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

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

const resolveCurrentAccountRole = (req) => {
  const requestedRole = req.query.as?.toString().trim();

  if (requestedRole === 'driver') {
    if (!req.roles?.includes('driver')) {
      const error = new Error('حساب السائق غير متاح لهذا المستخدم');
      error.statusCode = 403;
      throw error;
    }

    return 'driver';
  }

  return 'customer';
};

const getMyLoyalty = asyncHandler(async (req, res) => {
  const accountRole = resolveCurrentAccountRole(req);

  const loyaltyAccount = await getOrCreateLoyaltyAccount({
    accountId: req.accountId,
    accountRole,
  });

  const recentTransactions = await LoyaltyTransaction.find({
    accountId: req.accountId,
    accountRole,
  })
    .sort({ createdAt: -1 })
    .limit(10);

  return sendSuccess({
    res,
    message: 'تم جلب حساب الولاء بنجاح',
    doc: {
      loyaltyAccount,
      recentTransactions,
    },
  });
});

const getMyLoyaltyTransactions = asyncHandler(async (req, res) => {
  const accountRole = resolveCurrentAccountRole(req);
  const { type, page = 1, limit = 30 } = req.query;

  const query = {
    accountId: req.accountId,
    accountRole,
  };

  if (type) {
    query.type = type;
  }

  const total = await LoyaltyTransaction.countDocuments(query);
  const { skip, limitNumber, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await LoyaltyTransaction.find(query)
    .populate('serviceRequestId', 'requestCode serviceType status finalPrice createdAt')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب سجل نقاط الولاء بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAdminLoyaltyAccounts = asyncHandler(async (req, res) => {
  const {
    accountRole,
    tier,
    search,
    page = 1,
    limit = 30,
  } = req.query;

  const accountQuery = {};

  if (search) {
    const regex = new RegExp(search.toString().trim(), 'i');
    const accounts = await Account.find({
      $or: [{ name: regex }, { phone: regex }, { email: regex }],
    }).select('_id');

    accountQuery.accountId = { $in: accounts.map((account) => account._id) };
  }

  if (accountRole) {
    accountQuery.accountRole = accountRole;
  }

  if (tier) {
    accountQuery.tier = tier;
  }

  const total = await LoyaltyAccount.countDocuments(accountQuery);
  const { skip, limitNumber, pagination } = buildPagination({
    page,
    limit,
    total,
  });

  const docs = await LoyaltyAccount.find(accountQuery)
    .populate('accountId', 'name phone email roles isActive')
    .sort({ pointsBalance: -1, updatedAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب حسابات الولاء بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAdminLoyaltyAccountDetails = asyncHandler(async (req, res) => {
  const { accountId } = req.params;

  if (!isValidObjectId(accountId)) {
    const error = new Error('رقم الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const account = await Account.findById(accountId).select('name phone email roles isActive');

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const accountRole = req.query.as === 'driver' && account.roles.includes('driver')
    ? 'driver'
    : 'customer';

  const loyaltyAccount = await getOrCreateLoyaltyAccount({
    accountId,
    accountRole,
  });

  const transactions = await LoyaltyTransaction.find({
    accountId,
    accountRole,
  })
    .populate('serviceRequestId', 'requestCode serviceType status finalPrice createdAt')
    .populate('penaltyLogId', 'penaltyType reason phase blockMinutes createdAt')
    .populate('adminId', 'name phone')
    .sort({ createdAt: -1 })
    .limit(50);

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل حساب الولاء بنجاح',
    doc: {
      account,
      loyaltyAccount,
      transactions,
    },
  });
});

const adjustLoyaltyPointsForAdmin = asyncHandler(async (req, res) => {
  const { accountId } = req.params;
  const { accountRole = 'customer', direction, points, reason } = req.body;

  if (!isValidObjectId(accountId)) {
    const error = new Error('رقم الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const account = await Account.findById(accountId);

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (accountRole === 'driver' && !account.roles.includes('driver')) {
    const error = new Error('هذا الحساب ليس سائقًا');
    error.statusCode = 400;
    throw error;
  }

  const loyaltyAccountBefore = await getOrCreateLoyaltyAccount({
    accountId,
    accountRole,
  });
  const oldValue = loyaltyAccountBefore.toObject();

  const transaction = await adminAdjustLoyaltyPoints({
    accountId,
    accountRole,
    points,
    direction,
    reason: reason || 'تعديل نقاط من الداشبورد',
    adminId: req.accountId,
  });

  const loyaltyAccountAfter = await LoyaltyAccount.findOne({ accountId, accountRole });

  await createAdminAuditLog({
    req,
    module: 'loyalty',
    action: 'adjust_points',
    entityType: 'LoyaltyAccount',
    entityId: loyaltyAccountAfter?._id || loyaltyAccountBefore._id,
    oldValue,
    newValue: loyaltyAccountAfter,
    reason: reason || 'تعديل نقاط من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل نقاط الولاء بنجاح',
    doc: {
      loyaltyAccount: loyaltyAccountAfter,
      transaction,
    },
  });
});

const getAdminLoyaltyTransactions = asyncHandler(async (req, res) => {
  const {
    accountId,
    accountRole,
    type,
    source,
    from,
    to,
    page = 1,
    limit = 30,
  } = req.query;

  const query = {};

  if (accountId) {
    if (!isValidObjectId(accountId)) {
      const error = new Error('رقم الحساب غير صحيح');
      error.statusCode = 400;
      throw error;
    }

    query.accountId = accountId;
  }

  if (accountRole) {
    query.accountRole = accountRole;
  }

  if (type) {
    query.type = type;
  }

  if (source) {
    query.source = source;
  }

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const total = await LoyaltyTransaction.countDocuments(query);
  const { skip, limitNumber, pagination } = buildPagination({ page, limit, total });

  const docs = await LoyaltyTransaction.find(query)
    .populate('accountId', 'name phone email roles')
    .populate('serviceRequestId', 'requestCode serviceType status finalPrice')
    .populate('penaltyLogId', 'penaltyType reason phase')
    .populate('adminId', 'name phone')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNumber);

  return sendSuccess({
    res,
    message: 'تم جلب حركات نقاط الولاء بنجاح',
    docs,
    extra: {
      pagination,
    },
  });
});

const getAdminLoyaltySettings = asyncHandler(async (req, res) => {
  const settings = await getLoyaltySettings();

  return sendSuccess({
    res,
    message: 'تم جلب إعدادات الولاء بنجاح',
    doc: settings,
  });
});

const updateAdminLoyaltySettings = asyncHandler(async (req, res) => {
  const settings = await getAppSettings();
  const oldValue = settings.toObject();

  const allowedFields = [
    'isEnabled',
    'customerEarnPointsPerFarePound',
    'driverEarnPointsPerCompletedRequest',
    'customerAfterAcceptanceCancelDeductionPoints',
    'driverAfterAcceptanceCancelDeductionPoints',
    'allowNegativeBalance',
    'tierRules',
  ];

  const nextLoyalty = {
    ...DEFAULT_LOYALTY_SETTINGS,
    ...(settings.loyalty || {}),
    tierRules: {
      ...DEFAULT_LOYALTY_SETTINGS.tierRules,
      ...(settings.loyalty?.tierRules || {}),
    },
  };

  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      if (field === 'tierRules') {
        nextLoyalty.tierRules = {
          ...nextLoyalty.tierRules,
          ...req.body.tierRules,
        };
      } else {
        nextLoyalty[field] = req.body[field];
      }
    }
  }

  settings.loyalty = nextLoyalty;
  settings.updatedByAdminId = req.accountId;
  await settings.save();

  await createAdminAuditLog({
    req,
    module: 'loyalty',
    action: 'update_settings',
    entityType: 'AppSettings',
    entityId: settings._id,
    oldValue,
    newValue: settings,
    reason: req.body.reason || 'تعديل إعدادات الولاء من الداشبورد',
  });

  return sendSuccess({
    res,
    message: 'تم تعديل إعدادات الولاء بنجاح',
    doc: settings.loyalty,
  });
});

const ensureLoyaltyAccountForCurrentUser = asyncHandler(async (req, res) => {
  const accountRole = resolveCurrentAccountRole(req);
  const loyaltyAccount = await getOrCreateLoyaltyAccount({
    accountId: req.accountId,
    accountRole,
  });

  return sendSuccess({
    res,
    message: 'تم تجهيز حساب الولاء بنجاح',
    doc: loyaltyAccount,
  });
});

module.exports = {
  getMyLoyalty,
  getMyLoyaltyTransactions,
  ensureLoyaltyAccountForCurrentUser,
  getAdminLoyaltyAccounts,
  getAdminLoyaltyAccountDetails,
  adjustLoyaltyPointsForAdmin,
  getAdminLoyaltyTransactions,
  getAdminLoyaltySettings,
  updateAdminLoyaltySettings,
};
