const AccountRestriction = require('../models/accountRestriction.model');
const CancellationPolicy = require('../models/cancellationPolicy.model');
const PenaltyLog = require('../models/penaltyLog.model');
const ServiceRequest = require('../models/serviceRequest.model');
const { removeDriverCouponsForPenalty } = require('./promo.service');
const { deductLoyaltyForPenalty } = require('./loyalty.service');

const DEFAULT_POLICIES = {
  customer: {
    actorType: 'customer',
    serviceType: 'all',
    beforeAcceptancePenaltyEnabled: false,
    repeatedCancelLimit: 3,
    repeatedCancelWindowHours: 24,
    beforeAcceptanceBlockMinutes: 0,
    afterAcceptanceBlockMinutes: 60,
    loyaltyDeductionPoints: 100,
    removeDriverCoupons: false,
    driverCouponRemoveMode: 'none',
    isActive: true,
  },
  driver: {
    actorType: 'driver',
    serviceType: 'all',
    beforeAcceptancePenaltyEnabled: false,
    repeatedCancelLimit: 3,
    repeatedCancelWindowHours: 24,
    beforeAcceptanceBlockMinutes: 0,
    afterAcceptanceBlockMinutes: 900,
    loyaltyDeductionPoints: 0,
    removeDriverCoupons: true,
    driverCouponRemoveMode: 'unused',
    isActive: true,
  },
};

const normalizeServiceType = (serviceType) => {
  return serviceType || 'all';
};

const toPlainObject = (doc) => {
  if (!doc) {
    return null;
  }

  if (typeof doc.toObject === 'function') {
    return doc.toObject();
  }

  return doc;
};

const getDefaultPolicy = (actorType, serviceType = 'all') => {
  return {
    ...DEFAULT_POLICIES[actorType],
    serviceType: normalizeServiceType(serviceType),
  };
};

const getCancellationPolicyFor = async ({ actorType, serviceType }) => {
  const normalizedServiceType = normalizeServiceType(serviceType);

  const policy = await CancellationPolicy.findOne({
    actorType,
    serviceType: { $in: [normalizedServiceType, 'all'] },
    isActive: true,
  }).sort({ serviceType: normalizedServiceType === 'all' ? 1 : -1 });

  if (policy) {
    return policy;
  }

  return getDefaultPolicy(actorType, normalizedServiceType);
};

const seedDefaultCancellationPolicies = async ({ adminId = null } = {}) => {
  const defaults = [
    getDefaultPolicy('customer', 'all'),
    getDefaultPolicy('driver', 'all'),
  ];

  const docs = [];

  for (const item of defaults) {
    const doc = await CancellationPolicy.findOneAndUpdate(
      {
        actorType: item.actorType,
        serviceType: item.serviceType,
      },
      {
        $setOnInsert: {
          ...item,
          updatedBy: adminId,
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    docs.push(doc);
  }

  return docs;
};

const deactivateExpiredRestrictions = async () => {
  const now = new Date();

  await AccountRestriction.updateMany(
    {
      isActive: true,
      endsAt: { $ne: null, $lte: now },
    },
    {
      isActive: false,
      deactivatedAt: now,
      deactivateReason: 'انتهت مدة الحظر تلقائيًا',
    }
  );
};

const getActiveRestrictions = async ({ accountId, restrictionTypes = [] }) => {
  await deactivateExpiredRestrictions();

  const now = new Date();
  const query = {
    accountId,
    isActive: true,
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  };

  if (restrictionTypes.length > 0) {
    query.restrictionType = { $in: restrictionTypes };
  }

  return AccountRestriction.find(query).sort({ createdAt: -1 });
};

const getRestrictedAccountIds = async ({ accountIds, restrictionTypes = [] }) => {
  if (!accountIds || accountIds.length === 0) {
    return new Set();
  }

  await deactivateExpiredRestrictions();

  const now = new Date();
  const query = {
    accountId: { $in: accountIds },
    isActive: true,
    startsAt: { $lte: now },
    $or: [{ endsAt: null }, { endsAt: { $gt: now } }],
  };

  if (restrictionTypes.length > 0) {
    query.restrictionType = { $in: restrictionTypes };
  }

  const docs = await AccountRestriction.find(query).select('accountId');

  return new Set(docs.map((doc) => doc.accountId.toString()));
};

const assertNoActiveRestriction = async ({ accountId, restrictionTypes = [] }) => {
  const restrictions = await getActiveRestrictions({
    accountId,
    restrictionTypes,
  });

  if (restrictions.length === 0) {
    return null;
  }

  const firstRestriction = restrictions[0];
  const untilText = firstRestriction.endsAt
    ? ` حتى ${firstRestriction.endsAt.toISOString()}`
    : '';

  const error = new Error(
    `${firstRestriction.reason || 'هذا الحساب عليه حظر نشط'}${untilText}`
  );
  error.statusCode = 403;
  error.restrictions = restrictions;
  throw error;
};

const getCancellationPhase = ({ request, statusBeforeCancellation, actorType }) => {
  if (!request) {
    return 'manual';
  }

  const oldStatus = statusBeforeCancellation || request.status;
  const afterAcceptanceStatuses = [
    'offer_accepted',
    'driver_arriving',
    'arrived_to_pickup',
    'in_progress',
  ];

  if (request.acceptedDriverAccountId || afterAcceptanceStatuses.includes(oldStatus)) {
    return 'after_acceptance';
  }

  if (actorType === 'customer') {
    return 'before_acceptance';
  }

  return 'before_acceptance';
};

const countRecentCancellations = async ({
  accountId,
  actorType,
  serviceType,
  windowHours,
}) => {
  const since = new Date(Date.now() - Number(windowHours || 24) * 60 * 60 * 1000);
  const query = {
    serviceType,
    cancelledAt: { $gte: since },
  };

  if (actorType === 'customer') {
    query.customerAccountId = accountId;
    query.status = 'cancelled_by_customer';
  } else {
    query.acceptedDriverAccountId = accountId;
    query.status = 'cancelled_by_driver';
  }

  return ServiceRequest.countDocuments(query);
};

const getRestrictionTypesForPenalty = ({ actorType, phase }) => {
  if (actorType === 'customer') {
    return phase === 'after_acceptance'
      ? ['app_usage', 'creating_requests']
      : ['creating_requests'];
  }

  if (actorType === 'driver') {
    return ['driver_online', 'receiving_requests'];
  }

  return ['app_usage'];
};

const createRestrictionsForPenalty = async ({
  accountId,
  actorType,
  serviceRequestId,
  penaltyId,
  reason,
  blockMinutes,
  createdBy = 'system',
  adminId = null,
  phase,
}) => {
  const minutes = Number(blockMinutes || 0);

  if (minutes <= 0) {
    return [];
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + minutes * 60 * 1000);
  const restrictionTypes = getRestrictionTypesForPenalty({ actorType, phase });

  const docs = await AccountRestriction.insertMany(
    restrictionTypes.map((restrictionType) => ({
      accountId,
      restrictionType,
      reason,
      startsAt,
      endsAt,
      isActive: true,
      source: createdBy === 'admin' ? 'admin' : 'system',
      penaltyId,
      serviceRequestId,
      createdBy,
      adminId,
    }))
  );

  return docs;
};

const applyCancellationPenalty = async ({
  request,
  actorType,
  accountId,
  reason = '',
  statusBeforeCancellation = '',
  createdBy = 'system',
  adminId = null,
}) => {
  const phase = getCancellationPhase({
    request,
    statusBeforeCancellation,
    actorType,
  });

  const policy = await getCancellationPolicyFor({
    actorType,
    serviceType: request.serviceType,
  });

  const plainPolicy = toPlainObject(policy);
  let shouldApply = false;
  let penaltyType = 'warning';
  let blockMinutes = 0;

  if (phase === 'after_acceptance') {
    shouldApply = true;
    penaltyType = 'cancellation_after_acceptance';
    blockMinutes = Number(plainPolicy.afterAcceptanceBlockMinutes || 0);
  }

  if (phase === 'before_acceptance') {
    const policyEnabled = plainPolicy.beforeAcceptancePenaltyEnabled === true;

    if (policyEnabled) {
      const recentCount = await countRecentCancellations({
        accountId,
        actorType,
        serviceType: request.serviceType,
        windowHours: plainPolicy.repeatedCancelWindowHours,
      });

      const limitIncludingCurrent = Number(plainPolicy.repeatedCancelLimit || 1);

      if (recentCount + 1 >= limitIncludingCurrent) {
        shouldApply = true;
        penaltyType = 'repeated_cancellation_before_acceptance';
        blockMinutes = Number(plainPolicy.beforeAcceptanceBlockMinutes || 0);
      }
    }
  }

  if (!shouldApply) {
    return {
      applied: false,
      phase,
      policy: plainPolicy,
    };
  }

  const blockUntil = blockMinutes > 0
    ? new Date(Date.now() + blockMinutes * 60 * 1000)
    : null;

  const penalty = await PenaltyLog.create({
    accountId,
    accountRole: actorType,
    serviceRequestId: request._id,
    penaltyType,
    phase,
    reason,
    blockMinutes,
    blockUntil,
    loyaltyPointsDeducted: Number(plainPolicy.loyaltyDeductionPoints || 0),
    removeDriverCoupons:
      actorType === 'driver' && plainPolicy.removeDriverCoupons === true,
    driverCouponRemoveMode:
      actorType === 'driver'
        ? plainPolicy.driverCouponRemoveMode || 'none'
        : 'none',
    policySnapshot: plainPolicy,
    metadata: {
      statusBeforeCancellation,
      serviceType: request.serviceType,
      requestCode: request.requestCode,
    },
    createdBy,
    adminId,
  });

  const restrictions = await createRestrictionsForPenalty({
    accountId,
    actorType,
    serviceRequestId: request._id,
    penaltyId: penalty._id,
    reason,
    blockMinutes,
    createdBy,
    adminId,
    phase,
  });

  penalty.restrictionIds = restrictions.map((doc) => doc._id);

  const loyaltyDeductionPoints = Number(plainPolicy.loyaltyDeductionPoints || 0);

  if (loyaltyDeductionPoints > 0) {
    const loyaltyTransaction = await deductLoyaltyForPenalty({
      accountId,
      accountRole: actorType,
      points: loyaltyDeductionPoints,
      serviceRequestId: request._id,
      penaltyLogId: penalty._id,
      reason: reason || 'خصم نقاط بسبب الإلغاء',
    });

    penalty.loyaltyPointsDeducted = loyaltyTransaction?.points || 0;
    penalty.metadata = {
      ...(penalty.metadata || {}),
      requestedLoyaltyDeductionPoints: loyaltyDeductionPoints,
      actualLoyaltyDeductionPoints: loyaltyTransaction?.points || 0,
      loyaltyTransactionId: loyaltyTransaction?._id || null,
    };
  }

  if (
    actorType === 'driver' &&
    plainPolicy.removeDriverCoupons === true &&
    plainPolicy.driverCouponRemoveMode !== 'none'
  ) {
    const couponRemoval = await removeDriverCouponsForPenalty({
      accountId,
      penaltyLogId: penalty._id,
      mode: plainPolicy.driverCouponRemoveMode || 'unused',
    });

    penalty.removedPromoIds = couponRemoval.removedPromoIds || [];
    penalty.metadata = {
      ...(penalty.metadata || {}),
      removedDriverCouponsCount: couponRemoval.affectedCount || 0,
      driverCouponRemoveMode: plainPolicy.driverCouponRemoveMode || 'unused',
    };
  }

  await penalty.save();

  return {
    applied: true,
    phase,
    policy: plainPolicy,
    penalty,
    restrictions,
  };
};

module.exports = {
  DEFAULT_POLICIES,
  getCancellationPolicyFor,
  seedDefaultCancellationPolicies,
  deactivateExpiredRestrictions,
  getActiveRestrictions,
  getRestrictedAccountIds,
  assertNoActiveRestriction,
  applyCancellationPenalty,
};
