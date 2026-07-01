const LoyaltyAccount = require('../models/loyaltyAccount.model');
const LoyaltyTransaction = require('../models/loyaltyTransaction.model');
const { getAppSettings } = require('./appSettings.service');

const DEFAULT_LOYALTY_SETTINGS = {
  isEnabled: true,
  customerEarnPointsPerFarePound: 1,
  driverEarnPointsPerCompletedRequest: 10,
  customerAfterAcceptanceCancelDeductionPoints: 100,
  driverAfterAcceptanceCancelDeductionPoints: 0,
  allowNegativeBalance: false,
  tierRules: {
    silver: 500,
    gold: 1500,
    platinum: 5000,
  },
};

const normalizeRole = (role) => {
  return role === 'driver' ? 'driver' : 'customer';
};

const normalizePoints = (points) => {
  return Math.max(Math.floor(Number(points) || 0), 0);
};

const getLoyaltySettings = async () => {
  const settings = await getAppSettings();

  return {
    ...DEFAULT_LOYALTY_SETTINGS,
    ...(settings.loyalty || {}),
    tierRules: {
      ...DEFAULT_LOYALTY_SETTINGS.tierRules,
      ...(settings.loyalty?.tierRules || {}),
    },
  };
};

const calculateTier = ({ pointsBalance, settings }) => {
  const points = normalizePoints(pointsBalance);
  const tierRules = settings?.tierRules || DEFAULT_LOYALTY_SETTINGS.tierRules;

  if (points >= Number(tierRules.platinum || 0)) {
    return 'platinum';
  }

  if (points >= Number(tierRules.gold || 0)) {
    return 'gold';
  }

  if (points >= Number(tierRules.silver || 0)) {
    return 'silver';
  }

  return 'bronze';
};

const getOrCreateLoyaltyAccount = async ({ accountId, accountRole }) => {
  const role = normalizeRole(accountRole);

  let loyaltyAccount = await LoyaltyAccount.findOne({ accountId, accountRole: role });

  if (!loyaltyAccount) {
    loyaltyAccount = await LoyaltyAccount.create({
      accountId,
      accountRole: role,
    });
  }

  return loyaltyAccount;
};

const buildTransactionKey = ({ source, type, accountId, serviceRequestId, penaltyLogId }) => {
  if (source === 'completed_request' && serviceRequestId) {
    return `loyalty:${type}:${accountId}:${serviceRequestId}`;
  }

  if (source === 'cancellation_penalty' && penaltyLogId) {
    return `loyalty:${type}:${accountId}:${penaltyLogId}`;
  }

  return '';
};

const applyLoyaltyTransaction = async ({
  accountId,
  accountRole,
  type,
  points,
  direction,
  reason = '',
  source = 'manual',
  serviceRequestId = null,
  penaltyLogId = null,
  promoRedemptionId = null,
  adminId = null,
  metadata = {},
  transactionKey = '',
}) => {
  const normalizedPoints = normalizePoints(points);

  if (!accountId || normalizedPoints <= 0) {
    return null;
  }

  const key = transactionKey || buildTransactionKey({
    source,
    type,
    accountId,
    serviceRequestId,
    penaltyLogId,
  });

  if (key) {
    const existing = await LoyaltyTransaction.findOne({ transactionKey: key });
    if (existing) {
      return existing;
    }
  }

  const settings = await getLoyaltySettings();

  if (!settings.isEnabled && source !== 'admin_adjust') {
    return null;
  }

  const loyaltyAccount = await getOrCreateLoyaltyAccount({
    accountId,
    accountRole,
  });

  const balanceBefore = normalizePoints(loyaltyAccount.pointsBalance);
  let effectivePoints = normalizedPoints;
  let balanceAfter = balanceBefore;

  if (direction === 'credit') {
    balanceAfter = balanceBefore + normalizedPoints;
    loyaltyAccount.totalEarned += normalizedPoints;
  } else {
    if (settings.allowNegativeBalance) {
      balanceAfter = Math.max(balanceBefore - normalizedPoints, 0);
      effectivePoints = normalizedPoints;
    } else {
      effectivePoints = Math.min(normalizedPoints, balanceBefore);
      balanceAfter = Math.max(balanceBefore - effectivePoints, 0);
    }

    if (type === 'spend') {
      loyaltyAccount.totalSpent += effectivePoints;
    } else {
      loyaltyAccount.totalDeducted += effectivePoints;
    }
  }

  if (effectivePoints <= 0) {
    return null;
  }

  loyaltyAccount.pointsBalance = balanceAfter;
  loyaltyAccount.tier = calculateTier({ pointsBalance: balanceAfter, settings });
  await loyaltyAccount.save();

  return LoyaltyTransaction.create({
    loyaltyAccountId: loyaltyAccount._id,
    accountId,
    accountRole: normalizeRole(accountRole),
    type,
    direction,
    points: effectivePoints,
    balanceBefore,
    balanceAfter,
    reason,
    source,
    serviceRequestId,
    penaltyLogId,
    promoRedemptionId,
    adminId,
    transactionKey: key,
    metadata: {
      ...metadata,
      requestedPoints: normalizedPoints,
    },
  });
};

const earnLoyaltyPoints = async ({
  accountId,
  accountRole,
  points,
  reason,
  source,
  serviceRequestId = null,
  metadata = {},
}) => {
  return applyLoyaltyTransaction({
    accountId,
    accountRole,
    type: 'earn',
    points,
    direction: 'credit',
    reason,
    source,
    serviceRequestId,
    metadata,
  });
};

const deductLoyaltyPoints = async ({
  accountId,
  accountRole,
  points,
  reason,
  source,
  serviceRequestId = null,
  penaltyLogId = null,
  adminId = null,
  metadata = {},
}) => {
  return applyLoyaltyTransaction({
    accountId,
    accountRole,
    type: source === 'admin_adjust' ? 'admin_adjust' : 'deduct',
    points,
    direction: 'debit',
    reason,
    source,
    serviceRequestId,
    penaltyLogId,
    adminId,
    metadata,
  });
};

const adminAdjustLoyaltyPoints = async ({
  accountId,
  accountRole,
  points,
  direction,
  reason,
  adminId,
}) => {
  return applyLoyaltyTransaction({
    accountId,
    accountRole,
    type: 'admin_adjust',
    points,
    direction,
    reason,
    source: 'admin_adjust',
    adminId,
    metadata: {
      adjustedByAdmin: true,
    },
  });
};

const awardLoyaltyForCompletedRequest = async ({ request }) => {
  if (!request || request.status !== 'completed') {
    return {
      customerTransaction: null,
      driverTransaction: null,
    };
  }

  const settings = await getLoyaltySettings();

  if (!settings.isEnabled) {
    return {
      customerTransaction: null,
      driverTransaction: null,
    };
  }

  const fareForCustomerPoints = Math.max(Number(request.finalPrice || 0), 0);
  const customerPoints = normalizePoints(
    fareForCustomerPoints * Number(settings.customerEarnPointsPerFarePound || 0)
  );

  const driverPoints = normalizePoints(
    Number(settings.driverEarnPointsPerCompletedRequest || 0)
  );

  const [customerTransaction, driverTransaction] = await Promise.all([
    customerPoints > 0
      ? earnLoyaltyPoints({
          accountId: request.customerAccountId,
          accountRole: 'customer',
          points: customerPoints,
          reason: 'نقاط مكتسبة بعد إتمام الرحلة',
          source: 'completed_request',
          serviceRequestId: request._id,
          metadata: {
            finalPrice: request.finalPrice,
            customerPayablePrice: request.customerPayablePrice,
          },
        })
      : null,
    request.acceptedDriverAccountId && driverPoints > 0
      ? earnLoyaltyPoints({
          accountId: request.acceptedDriverAccountId,
          accountRole: 'driver',
          points: driverPoints,
          reason: 'نقاط مكتسبة للسائق بعد إتمام الرحلة',
          source: 'completed_request',
          serviceRequestId: request._id,
          metadata: {
            finalPrice: request.finalPrice,
            commissionAmount: request.commissionAmount,
          },
        })
      : null,
  ]);

  return {
    customerTransaction,
    driverTransaction,
  };
};

const deductLoyaltyForPenalty = async ({
  accountId,
  accountRole,
  points,
  serviceRequestId,
  penaltyLogId,
  reason,
}) => {
  return deductLoyaltyPoints({
    accountId,
    accountRole,
    points,
    reason,
    source: 'cancellation_penalty',
    serviceRequestId,
    penaltyLogId,
  });
};

module.exports = {
  DEFAULT_LOYALTY_SETTINGS,
  getLoyaltySettings,
  getOrCreateLoyaltyAccount,
  earnLoyaltyPoints,
  deductLoyaltyPoints,
  adminAdjustLoyaltyPoints,
  awardLoyaltyForCompletedRequest,
  deductLoyaltyForPenalty,
  calculateTier,
};
