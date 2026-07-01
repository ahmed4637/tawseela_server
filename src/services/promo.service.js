const mongoose = require('mongoose');

const PromoCode = require('../models/promoCode.model');
const PromoRedemption = require('../models/promoRedemption.model');

const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeCode = (code) => (code || '').toString().trim().toUpperCase();

const objectIdEquals = (value, target) => {
  if (!value || !target) return false;
  return value.toString() === target.toString();
};

const calculateDiscountAmount = ({ promo, amount }) => {
  const baseAmount = Math.max(Number(amount) || 0, 0);

  if (baseAmount <= 0) {
    return 0;
  }

  let discount = 0;

  if (promo.discountType === 'percentage') {
    discount = (baseAmount * Number(promo.discountValue || 0)) / 100;
  } else {
    discount = Number(promo.discountValue || 0);
  }

  if (Number(promo.maxDiscountAmount || 0) > 0) {
    discount = Math.min(discount, Number(promo.maxDiscountAmount));
  }

  return roundMoney(Math.min(Math.max(discount, 0), baseAmount));
};

const findPromoByCode = async ({ code, promoType }) => {
  const normalizedCode = normalizeCode(code);

  if (!normalizedCode) {
    return null;
  }

  return PromoCode.findOne({
    code: normalizedCode,
    promoType,
  });
};

const assertPromoCanBeUsed = async ({
  promo,
  accountId,
  promoType,
  serviceType,
  vehicleTypeCode,
  amount,
  includeReserved = true,
}) => {
  if (!promo) {
    const error = new Error('كود الخصم غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (promo.promoType !== promoType) {
    const error = new Error('كود الخصم غير صالح لهذا النوع من المستخدم');
    error.statusCode = 400;
    throw error;
  }

  if (!promo.isActive) {
    const error = new Error('كود الخصم غير مفعل');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();

  if (promo.startsAt && promo.startsAt > now) {
    const error = new Error('كود الخصم لم يبدأ بعد');
    error.statusCode = 400;
    throw error;
  }

  if (promo.endsAt && promo.endsAt < now) {
    const error = new Error('كود الخصم منتهي');
    error.statusCode = 400;
    throw error;
  }

  if (Number(promo.minFare || 0) > 0 && Number(amount || 0) < Number(promo.minFare)) {
    const error = new Error(`أقل قيمة لاستخدام الكوبون هي ${promo.minFare} جنيه`);
    error.statusCode = 400;
    throw error;
  }

  if (
    promo.serviceTypes?.length > 0 &&
    serviceType &&
    !promo.serviceTypes.includes(serviceType)
  ) {
    const error = new Error('كود الخصم غير صالح لهذه الخدمة');
    error.statusCode = 400;
    throw error;
  }

  const normalizedVehicleTypeCode = (vehicleTypeCode || '').toString().trim().toLowerCase();

  if (
    promo.vehicleTypeCodes?.length > 0 &&
    normalizedVehicleTypeCode &&
    !promo.vehicleTypeCodes.includes(normalizedVehicleTypeCode)
  ) {
    const error = new Error('كود الخصم غير صالح لنوع المركبة المختار');
    error.statusCode = 400;
    throw error;
  }

  if (
    promo.targetAccountIds?.length > 0 &&
    !promo.targetAccountIds.some((id) => objectIdEquals(id, accountId))
  ) {
    const error = new Error('كود الخصم غير مخصص لهذا الحساب');
    error.statusCode = 403;
    throw error;
  }

  if (promo.blockedAccountIds?.some((id) => objectIdEquals(id, accountId))) {
    const error = new Error('هذا الكوبون غير متاح لهذا الحساب');
    error.statusCode = 403;
    throw error;
  }

  const countedStatuses = includeReserved
    ? ['reserved', 'applied']
    : ['applied'];

  if (Number(promo.usageLimitTotal || 0) > 0) {
    const totalUsed = await PromoRedemption.countDocuments({
      promoCodeId: promo._id,
      status: { $in: countedStatuses },
    });

    if (totalUsed >= Number(promo.usageLimitTotal)) {
      const error = new Error('تم استهلاك عدد استخدامات الكوبون');
      error.statusCode = 400;
      throw error;
    }
  }

  if (Number(promo.usageLimitPerAccount || 0) > 0) {
    const accountUsed = await PromoRedemption.countDocuments({
      promoCodeId: promo._id,
      accountId,
      status: { $in: countedStatuses },
    });

    if (accountUsed >= Number(promo.usageLimitPerAccount)) {
      const error = new Error('تم استخدام هذا الكوبون من هذا الحساب من قبل');
      error.statusCode = 400;
      throw error;
    }
  }

  return true;
};

const validatePromoCode = async ({
  code,
  promoType,
  accountId,
  serviceType,
  vehicleTypeCode,
  amount,
  includeReserved = true,
}) => {
  const promo = await findPromoByCode({ code, promoType });

  await assertPromoCanBeUsed({
    promo,
    accountId,
    promoType,
    serviceType,
    vehicleTypeCode,
    amount,
    includeReserved,
  });

  const discountAmount = calculateDiscountAmount({ promo, amount });

  if (discountAmount <= 0) {
    const error = new Error('قيمة الخصم غير صالحة');
    error.statusCode = 400;
    throw error;
  }

  return {
    promo,
    discountAmount,
    finalAmount: roundMoney(Math.max(Number(amount || 0) - discountAmount, 0)),
    snapshot: buildPromoSnapshot({ promo, discountAmount }),
  };
};

const buildPromoSnapshot = ({ promo, discountAmount = 0 }) => ({
  promoCodeId: promo._id,
  code: promo.code,
  promoType: promo.promoType,
  discountType: promo.discountType,
  discountValue: promo.discountValue,
  maxDiscountAmount: promo.maxDiscountAmount,
  minFare: promo.minFare,
  serviceTypes: promo.serviceTypes || [],
  vehicleTypeCodes: promo.vehicleTypeCodes || [],
  discountAmount: roundMoney(discountAmount),
  capturedAt: new Date(),
});

const reserveCustomerPromoForRequest = async ({
  promo,
  accountId,
  serviceRequestId,
  amount,
  discountAmount,
}) => {
  return PromoRedemption.findOneAndUpdate(
    {
      promoCodeId: promo._id,
      accountId,
      serviceRequestId,
      accountRole: 'customer',
    },
    {
      promoCodeId: promo._id,
      code: promo.code,
      accountId,
      accountRole: 'customer',
      serviceRequestId,
      discountAmount: roundMoney(discountAmount),
      appliedTo: 'customer_fare',
      status: 'reserved',
      reservedAt: new Date(),
      metadata: {
        amountBeforeDiscount: roundMoney(amount),
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
};

const applyCustomerPromoForRequest = async ({ serviceRequestId }) => {
  const redemption = await PromoRedemption.findOne({
    serviceRequestId,
    accountRole: 'customer',
    status: 'reserved',
  });

  if (!redemption) {
    return null;
  }

  redemption.status = 'applied';
  redemption.appliedAt = new Date();
  await redemption.save();

  await PromoCode.updateOne(
    { _id: redemption.promoCodeId },
    { $inc: { usedCount: 1 } }
  );

  return redemption;
};

const cancelPromoReservationsForRequest = async ({ serviceRequestId }) => {
  return PromoRedemption.updateMany(
    {
      serviceRequestId,
      status: 'reserved',
    },
    {
      status: 'cancelled',
      cancelledAt: new Date(),
    }
  );
};


const reserveDriverPromoForAcceptedOffer = async ({
  promoCodeId,
  code,
  accountId,
  serviceRequestId,
  serviceOfferId,
  estimatedDiscountAmount = 0,
}) => {
  if (!promoCodeId || !code) {
    return null;
  }

  return PromoRedemption.findOneAndUpdate(
    {
      promoCodeId,
      accountId,
      serviceRequestId,
      serviceOfferId,
      accountRole: 'driver',
    },
    {
      promoCodeId,
      code,
      accountId,
      accountRole: 'driver',
      serviceRequestId,
      serviceOfferId,
      discountAmount: roundMoney(estimatedDiscountAmount),
      appliedTo: 'driver_commission',
      status: 'reserved',
      reservedAt: new Date(),
      metadata: {
        reservedFromAcceptedOffer: true,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );
};

const calculateDiscountFromSnapshot = ({ snapshot, amount }) => {
  if (!snapshot) return 0;

  const fakePromo = {
    discountType: snapshot.discountType,
    discountValue: snapshot.discountValue,
    maxDiscountAmount: snapshot.maxDiscountAmount,
  };

  return calculateDiscountAmount({ promo: fakePromo, amount });
};

const applyDriverPromoToCommission = async ({
  request,
  offer,
  grossCommissionAmount,
}) => {
  if (!offer?.driverPromoCodeId || !offer?.driverPromoSnapshot) {
    return {
      discountAmount: 0,
      netCommissionAmount: roundMoney(grossCommissionAmount),
      redemption: null,
    };
  }

  const discountAmount = calculateDiscountFromSnapshot({
    snapshot: offer.driverPromoSnapshot,
    amount: grossCommissionAmount,
  });

  if (discountAmount <= 0) {
    return {
      discountAmount: 0,
      netCommissionAmount: roundMoney(grossCommissionAmount),
      redemption: null,
    };
  }

  const redemption = await PromoRedemption.findOneAndUpdate(
    {
      promoCodeId: offer.driverPromoCodeId,
      accountId: offer.driverAccountId,
      serviceRequestId: request._id,
      serviceOfferId: offer._id,
      accountRole: 'driver',
    },
    {
      promoCodeId: offer.driverPromoCodeId,
      code: offer.driverPromoCode,
      accountId: offer.driverAccountId,
      accountRole: 'driver',
      serviceRequestId: request._id,
      serviceOfferId: offer._id,
      discountAmount,
      appliedTo: 'driver_commission',
      status: 'applied',
      reservedAt: new Date(),
      appliedAt: new Date(),
      metadata: {
        grossCommissionAmount: roundMoney(grossCommissionAmount),
        netCommissionAmount: roundMoney(grossCommissionAmount - discountAmount),
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  await PromoCode.updateOne(
    { _id: offer.driverPromoCodeId },
    { $inc: { usedCount: 1 } }
  );

  return {
    discountAmount,
    netCommissionAmount: roundMoney(Math.max(grossCommissionAmount - discountAmount, 0)),
    redemption,
  };
};

const removeDriverCouponsForPenalty = async ({
  accountId,
  penaltyLogId,
  mode = 'unused',
}) => {
  if (!accountId || mode === 'none') {
    return { affectedCount: 0, removedPromoIds: [] };
  }

  const query = {
    promoType: 'driver',
    isActive: true,
    blockedAccountIds: { $ne: new mongoose.Types.ObjectId(accountId) },
  };

  const promos = await PromoCode.find(query).select('_id code');

  if (promos.length === 0) {
    return { affectedCount: 0, removedPromoIds: [] };
  }

  const promoIds = promos.map((promo) => promo._id);

  await PromoCode.updateMany(
    { _id: { $in: promoIds } },
    { $addToSet: { blockedAccountIds: accountId } }
  );

  await PromoRedemption.insertMany(
    promos.map((promo) => ({
      promoCodeId: promo._id,
      code: promo.code,
      accountId,
      accountRole: 'driver',
      penaltyLogId,
      discountAmount: 0,
      appliedTo: 'coupon_removal',
      status: 'removed_by_penalty',
      appliedAt: new Date(),
      metadata: {
        removalMode: mode,
      },
    })),
    { ordered: false }
  ).catch(() => null);

  return {
    affectedCount: promoIds.length,
    removedPromoIds: promoIds,
  };
};

module.exports = {
  normalizeCode,
  roundMoney,
  calculateDiscountAmount,
  validatePromoCode,
  buildPromoSnapshot,
  reserveCustomerPromoForRequest,
  applyCustomerPromoForRequest,
  cancelPromoReservationsForRequest,
  reserveDriverPromoForAcceptedOffer,
  applyDriverPromoToCommission,
  removeDriverCouponsForPenalty,
};
