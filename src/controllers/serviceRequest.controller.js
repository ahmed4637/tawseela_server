const mongoose = require("mongoose");
const crypto = require("crypto");

const ServiceRequest = require("../models/serviceRequest.model");
const ServiceOffer = require("../models/serviceOffer.model");
const Rating = require("../models/rating.model");
const Vehicle = require("../models/vehicle.model");
const DriverProfile = require("../models/driverProfile.model");
const DriverVehicle = require("../models/driverVehicle.model");
const {
  getSearchRadiusKmByServiceType,
  getScheduledRequestSettings,
  getOfferExpiryDate,
  buildRequestLifecycleDates,
} = require("../services/appSettings.service");
const {
  dispatchServiceRequestToNearbyDrivers,
} = require("../services/scheduledRequest.service");

const asyncHandler = require("../utils/asyncHandler");
const { sendSuccess } = require("../utils/apiResponse");
const { buildPublicUrl } = require("../utils/publicUrl");
const { createNotification } = require("../services/notification.service");
const {
  createChatRoomForAcceptedRequest,
} = require("../services/chat.service");
const {
  assertNoActiveRestriction,
  getRestrictedAccountIds,
  applyCancellationPenalty,
} = require("../services/penalty.service");
const {
  awardLoyaltyForCompletedRequest,
} = require("../services/loyalty.service");
const {
  recordCompletedRequestFinance,
} = require("../services/driverFinance.service");
const {
  validatePromoCode,
  reserveCustomerPromoForRequest,
  applyCustomerPromoForRequest,
  cancelPromoReservationsForRequest,
  reserveDriverPromoForAcceptedOffer,
  applyDriverPromoToCommission,
} = require("../services/promo.service");
const {
  emitToAdmins,
  emitToAccount,
  emitToRequest,
  emitToVehicle,
  emitToRooms,
  getAccountRoom,
  getRequestRoom,
} = require("../sockets/socket.server");

const isDevelopment = process.env.NODE_ENV === "development";

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const generateRequestCode = () => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `TS-${Date.now()}-${random}`;
};

const generateDeliveryHandoffOtp = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

const roundMoney = (value) => {
  return Math.round((Number(value) || 0) * 100) / 100;
};

const normalizeDeliveryPaymentResponsibility = (deliveryDetails = {}) => {
  if (deliveryDetails.itemPaymentResponsibility) {
    return deliveryDetails.itemPaymentResponsibility;
  }

  const driverPays =
    deliveryDetails.driverWillPayForItems === true ||
    deliveryDetails.driverPaysForItems === true ||
    deliveryDetails.driverPaidForItems === true ||
    deliveryDetails.itemCostPaidByDriver === true;

  return driverPays ? "driver_pays_pickup" : "customer_pays_pickup";
};

const firstNonEmptyValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value.toString().trim() !== "") {
      return value;
    }
  }

  return "";
};

const firstDefinedValue = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
};

const buildDeliveryDetailsPayload = (deliveryDetails = {}) => {
  const itemPaymentResponsibility = normalizeDeliveryPaymentResponsibility(
    deliveryDetails,
  );
  const driverWillPayForItems =
    itemPaymentResponsibility === "driver_pays_pickup" ||
    deliveryDetails.driverWillPayForItems === true;
  const expectedItemCost = roundMoney(
    firstDefinedValue(
      deliveryDetails.expectedItemCost,
      deliveryDetails.estimatedItemCost,
      deliveryDetails.itemEstimatedCost,
      0,
    ),
  );
  const maxItemCostAllowed = roundMoney(
    firstDefinedValue(
      deliveryDetails.maxItemCostAllowed,
      deliveryDetails.maxAllowedItemCost,
      deliveryDetails.maxAllowedValue,
      expectedItemCost,
      0,
    ),
  );

  const pickupContactName = firstNonEmptyValue(
    deliveryDetails.pickupContactName,
    deliveryDetails.pickupName,
    deliveryDetails.storeName,
  );
  const pickupContactPhone = firstNonEmptyValue(
    deliveryDetails.pickupContactPhone,
    deliveryDetails.pickupPhone,
    deliveryDetails.storePhone,
  );
  const dropoffContactName = firstNonEmptyValue(
    deliveryDetails.dropoffContactName,
    deliveryDetails.recipientName,
    deliveryDetails.receiverName,
  );
  const dropoffContactPhone = firstNonEmptyValue(
    deliveryDetails.dropoffContactPhone,
    deliveryDetails.recipientPhone,
    deliveryDetails.receiverPhone,
  );

  return {
    itemDescription: firstNonEmptyValue(
      deliveryDetails.itemDescription,
      deliveryDetails.description,
    ),
    itemCategory: firstNonEmptyValue(
      deliveryDetails.itemCategory,
      deliveryDetails.category,
    ),
    quantity: Math.max(Number(deliveryDetails.quantity || 1), 1),
    itemDeclaredValue: roundMoney(
      firstDefinedValue(
        deliveryDetails.itemDeclaredValue,
        deliveryDetails.declaredValue,
        deliveryDetails.expectedItemCost,
        0,
      ),
    ),
    pickupContactName,
    pickupContactPhone,
    dropoffContactName,
    dropoffContactPhone,
    itemPaymentResponsibility,
    driverWillPayForItems,
    expectedItemCost,
    maxItemCostAllowed,
    actualItemCost: 0,
    itemCostPaidByDriver: false,
    itemCostConfirmedAt: null,
    itemCostReimbursementAmount: 0,
    customerTotalPayableToDriver: 0,
    commissionableDeliveryFare: 0,
    pickupStatus: "pending",
    pickupConfirmedAt: null,
    pickupProofType: "none",
    pickupProofUrl: "",
    pickupProofNote: "",
    deliveryStatus: "pending",
    deliveredAt: null,
    deliveryProofType: "none",
    deliveryProofUrl: "",
    deliveryProofNote: "",
    recipientName: dropoffContactName,
    recipientPhone: dropoffContactPhone,
    handoffOtp: firstNonEmptyValue(deliveryDetails.handoffOtp) || generateDeliveryHandoffOtp(),
    paymentNotes: firstNonEmptyValue(
      deliveryDetails.paymentNotes,
      deliveryDetails.paymentNote,
      deliveryDetails.notes,
    ),
  };
};

const getDeliveryItemReimbursementAmount = (request) => {
  if (request.serviceType !== "delivery_order") {
    return 0;
  }

  const details = request.deliveryDetails || {};
  const responsibility = normalizeDeliveryPaymentResponsibility(details);

  if (responsibility !== "driver_pays_pickup") {
    return 0;
  }

  if (details.itemCostPaidByDriver === false) {
    return 0;
  }

  return roundMoney(details.actualItemCost || details.expectedItemCost || 0);
};

const assertDeliveryOrderRequest = (request) => {
  if (request.serviceType !== "delivery_order") {
    const error = new Error("هذا الإجراء متاح لخدمة توصيل الطلبات فقط");
    error.statusCode = 400;
    throw error;
  }
};

const assertAcceptedDriverForRequest = ({ request, accountId }) => {
  if (request.acceptedDriverAccountId?.toString() !== accountId) {
    const error = new Error("السائق المقبول فقط يمكنه تنفيذ هذا الإجراء");
    error.statusCode = 403;
    throw error;
  }
};

const assertDeliveryItemCostWithinLimit = ({ request, actualItemCost }) => {
  const details = request.deliveryDetails || {};
  const maxAllowed = roundMoney(
    details.maxItemCostAllowed || details.expectedItemCost || 0,
  );

  if (maxAllowed > 0 && roundMoney(actualItemCost) > maxAllowed) {
    const error = new Error(
      `قيمة الطلب الفعلية أكبر من الحد المسموح ${maxAllowed} جنيه`,
    );
    error.statusCode = 400;
    throw error;
  }
};


const addMinutes = (date, minutes) => {
  return new Date(new Date(date).getTime() + Number(minutes || 0) * 60 * 1000);
};

const assertScheduledRideLeadTime = async ({ scheduledAt }) => {
  const settings = await getScheduledRequestSettings();
  const scheduledDate = new Date(scheduledAt);
  const minAllowedDate = addMinutes(new Date(), settings.minLeadMinutes);

  if (scheduledDate < minAllowedDate) {
    const error = new Error(
      `وقت الحجز يجب أن يكون بعد ${settings.minLeadMinutes} دقيقة على الأقل`,
    );
    error.statusCode = 400;
    throw error;
  }

  return scheduledDate;
};

const isRequestDispatchedToDrivers = (request) => {
  if (request.serviceType !== "scheduled_ride") {
    return true;
  }

  return request.dispatchStatus === "dispatched";
};

const assertRequestCanReceiveDriverActivity = (request) => {
  if (!isRequestDispatchedToDrivers(request)) {
    const error = new Error("هذا الحجز غير متاح للسائقين حاليا");
    error.statusCode = 403;
    throw error;
  }

  if (request.requestExpiresAt && new Date(request.requestExpiresAt) <= new Date()) {
    const error = new Error("انتهت صلاحية هذا الطلب");
    error.statusCode = 410;
    throw error;
  }
};

const assertOfferStillValid = (offer) => {
  if (offer.expiresAt && new Date(offer.expiresAt) <= new Date()) {
    const error = new Error("انتهت صلاحية هذا العرض");
    error.statusCode = 410;
    throw error;
  }
};

const buildGeoPoint = ({ lat, lng }) => {
  return {
    type: "Point",
    coordinates: [Number(lng), Number(lat)],
  };
};

const calculateDistanceKm = ({ lat1, lng1, lat2, lng2 }) => {
  const earthRadiusKm = 6371;

  const toRad = (value) => (Number(value) * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusKm * c * 10) / 10;
};

const findNearbyDriverAccountIdsForRequest = async (request) => {
  const vehicleQuery = {
    vehicleTypeCode: request.vehicleTypeCode,
    isActive: true,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const driverVehicles =
    await DriverVehicle.find(vehicleQuery).select("accountId");

  const driverAccountIds = [
    ...new Set(driverVehicles.map((vehicle) => vehicle.accountId.toString())),
  ];

  if (driverAccountIds.length === 0) {
    return [];
  }

  const maxDistanceMeters = Number(request.searchRadiusKm || 5) * 1000;

  const profiles = await DriverProfile.find({
    accountId: { $in: driverAccountIds },
    isActive: true,
    isOnline: true,
    isAvailable: true,
    isBlockedForDebt: false,
    activeServiceRequestId: null,
    $expr: {
      $lt: ["$commissionDebt", "$commissionDebtLimit"],
    },
    currentLocation: {
      $near: {
        $geometry: request.pickupLocation,
        $maxDistance: maxDistanceMeters,
      },
    },
  }).select("accountId");

  const profileAccountIds = profiles.map((profile) => profile.accountId.toString());
  const restrictedAccountIds = await getRestrictedAccountIds({
    accountIds: profileAccountIds,
    restrictionTypes: ["app_usage", "driver_online", "receiving_requests"],
  });

  return profileAccountIds.filter(
    (accountId) => !restrictedAccountIds.has(accountId),
  );
};

const safeSocketEmit = (callback) => {
  try {
    callback();
  } catch (error) {
    console.error("Socket emit error:", error.message);
  }
};
const safeCreateNotification = async ({
  accountId,
  title,
  body,
  type = "general",
  data = {},
}) => {
  try {
    await createNotification({
      accountId,
      title,
      body,
      type,
      data,
    });
  } catch (error) {
    console.error("Create notification error:", error.message);
  }
};

const buildStatusNotifications = (request) => {
  const finalPrice = request.finalPrice || 0;
  const commissionAmount = request.commissionAmount || 0;

  const map = {
    driver_arriving: {
      customer: {
        title: "السائق في الطريق",
        body: "السائق بدأ التحرك إلى نقطة الانطلاق",
      },
      driver: {
        title: "تم تحديث حالة الطلب",
        body: "أنت الآن في الطريق إلى العميل",
      },
    },

    arrived_to_pickup: {
      customer: {
        title: "السائق وصل",
        body: "السائق وصل إلى نقطة الانطلاق",
      },
      driver: {
        title: "تم تسجيل الوصول",
        body: "تم تسجيل وصولك إلى العميل",
      },
    },

    in_progress: {
      customer: {
        title: "بدأت الرحلة",
        body: "تم بدء الرحلة بنجاح",
      },
      driver: {
        title: "بدأت الرحلة",
        body: "تم بدء الرحلة بنجاح",
      },
    },

    completed: {
      customer: {
        title: "تم إنهاء الطلب",
        body: `تم إنهاء الطلب بنجاح. السعر النهائي ${finalPrice} جنيه`,
      },
      driver: {
        title: "تم إنهاء الطلب",
        body: `تم إنهاء الطلب. عمولة التطبيق المستحقة ${commissionAmount} جنيه`,
      },
    },

    cancelled_by_customer: {
      customer: {
        title: "تم إلغاء الطلب",
        body: "تم إلغاء الطلب من طرف العميل",
      },
      driver: {
        title: "تم إلغاء الطلب",
        body: "العميل قام بإلغاء الطلب",
      },
    },

    cancelled_by_driver: {
      customer: {
        title: "تم إلغاء الطلب",
        body: "السائق قام بإلغاء الطلب",
      },
      driver: {
        title: "تم إلغاء الطلب",
        body: "تم إلغاء الطلب من طرفك",
      },
    },

    cancelled_by_admin: {
      customer: {
        title: "تم إلغاء الطلب",
        body: "تم إلغاء الطلب من الإدارة",
      },
      driver: {
        title: "تم إلغاء الطلب",
        body: "تم إلغاء الطلب من الإدارة",
      },
    },

    driver_no_show: {
      customer: {
        title: "تم تسجيل عدم حضور السائق",
        body: "تم تسجيل أن السائق لم يحضر للرحلة",
      },
      driver: {
        title: "تم تسجيل عدم حضور",
        body: "تم تسجيل عدم حضورك للرحلة",
      },
    },

    customer_no_show: {
      customer: {
        title: "تم تسجيل عدم حضور العميل",
        body: "تم تسجيل عدم حضورك للرحلة",
      },
      driver: {
        title: "تم تسجيل عدم حضور العميل",
        body: "تم تسجيل أن العميل لم يحضر للرحلة",
      },
    },
  };

  return map[request.status] || null;
};

const getCommissionPercent = (vehicle, serviceType) => {
  if (!vehicle?.commission) {
    return 0;
  }

  if (serviceType === "instant_ride") {
    return vehicle.commission.instantRidePercent || 0;
  }

  if (serviceType === "scheduled_ride") {
    return vehicle.commission.scheduledRidePercent || 0;
  }

  if (serviceType === "delivery_order") {
    return vehicle.commission.deliveryOrderPercent || 0;
  }

  return 0;
};

const calculateEstimatedPrice = ({ vehicle, distanceKm }) => {
  const distance = Number(distanceKm) || 0;

  const rawPrice =
    Number(vehicle.startPrice || 0) +
    distance * Number(vehicle.pricePerKm || 0);

  return roundMoney(Math.max(rawPrice, Number(vehicle.minPrice || 0)));
};

const calculateFinalFareOnCompletion = ({ request, vehicle, body = {} }) => {
  const agreedPrice = roundMoney(
    request.finalPrice || request.customerOfferedPrice || 0,
  );

  const originalDistanceKm = roundMoney(request.distanceKm || 0);

  const actualDistanceInput =
    body.actualDistanceKm ??
    body.finalDistanceKm ??
    body.completedDistanceKm ??
    null;

  const actualDistanceKm = roundMoney(
    actualDistanceInput !== null && actualDistanceInput !== undefined
      ? Math.max(Number(actualDistanceInput) || 0, originalDistanceKm)
      : originalDistanceKm,
  );

  const extraDistanceKm = roundMoney(
    Math.max(actualDistanceKm - originalDistanceKm, 0),
  );

  const pricePerExtraKm = roundMoney(
    Number(vehicle?.pricePerKm || vehicle?.extraPricePerKm || 0),
  );

  const extraDistanceFare = roundMoney(extraDistanceKm * pricePerExtraKm);

  const waitingMinutes = Math.max(
    Number(body.waitingMinutes ?? body.waitMinutes ?? 0) || 0,
    0,
  );

  const waitingPricePerMinute = roundMoney(
    Number(
      vehicle?.waitingPricePerMinute ||
        vehicle?.pricePerWaitingMinute ||
        vehicle?.waitingMinutePrice ||
        0,
    ),
  );

  const waitingFare = roundMoney(waitingMinutes * waitingPricePerMinute);

  const manualAdjustment = roundMoney(
    Number(body.manualAdjustment ?? body.extraFare ?? 0) || 0,
  );

  const totalIncrease = roundMoney(
    Math.max(extraDistanceFare + waitingFare + manualAdjustment, 0),
  );

  const finalPrice = roundMoney(agreedPrice + totalIncrease);

  return {
    finalPrice,
    details: {
      agreedPrice,
      originalDistanceKm,
      actualDistanceKm,
      extraDistanceKm,
      pricePerExtraKm,
      extraDistanceFare,
      waitingMinutes,
      waitingPricePerMinute,
      waitingFare,
      manualAdjustment,
      totalIncrease,
      calculatedAt: new Date(),
      note: body.finalFareNote || "",
    },
  };
};

const ensureRequestExists = async (requestId) => {
  if (!isValidObjectId(requestId)) {
    const error = new Error("رقم الطلب غير صحيح");
    error.statusCode = 400;
    throw error;
  }

  const request = await ServiceRequest.findById(requestId);

  if (!request) {
    const error = new Error("الطلب غير موجود");
    error.statusCode = 404;
    throw error;
  }

  return request;
};

const ensureDriverCanWork = async (accountId, options = {}) => {
  const driverProfile = await DriverProfile.findOne({ accountId });

  if (!driverProfile) {
    const error = new Error("ملف السائق غير موجود");
    error.statusCode = 403;
    throw error;
  }

  await assertNoActiveRestriction({
    accountId,
    restrictionTypes: ["app_usage", "driver_online", "receiving_requests"],
  });

  driverProfile.refreshDebtBlockStatus();
  await driverProfile.save();

  if (
    !driverProfile.isApproved ||
    driverProfile.reviewStatus !== "approved"
  ) {
    const error = new Error("حساب السائق لم تتم الموافقة عليه بعد");
    error.statusCode = 403;
    throw error;
  }

  if (!driverProfile.isOnline) {
    const error = new Error("يجب أن يكون السائق Online لاستقبال الطلبات");
    error.statusCode = 403;
    throw error;
  }

  if (driverProfile.isBlockedForDebt) {
    const error = new Error(
      driverProfile.blockedReason ||
        "تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق",
    );
    error.statusCode = 403;
    throw error;
  }

  if (driverProfile.commissionDebt >= driverProfile.commissionDebtLimit) {
    const error = new Error("يجب سداد مستحقات التطبيق قبل استقبال طلبات جديدة");
    error.statusCode = 403;
    throw error;
  }

  if (driverProfile.activeServiceRequestId) {
    const activeRequestId = driverProfile.activeServiceRequestId.toString();
    const currentRequestId = options.currentRequestId
      ? options.currentRequestId.toString()
      : '';

    const isSameRequest =
      currentRequestId && activeRequestId === currentRequestId;

    if (!isSameRequest) {
      if (options.silentActiveRequest) {
        driverProfile.$locals = driverProfile.$locals || {};
        driverProfile.$locals.hasActiveRequestConflict = true;
        return driverProfile;
      }

      const error = new Error(
        "لا يمكن للسائق العمل على أكثر من طلب في نفس الوقت",
      );
      error.statusCode = 403;
      throw error;
    }
  }

  return driverProfile;
};

const createServiceRequest = asyncHandler(async (req, res) => {
  const {
    serviceType,
    vehicleTypeId,
    vehicleTypeCode,
    vehicleTypeName,
    pickup,
    destination,
    distanceKm,
    customerOfferedPrice,
    customerPromoCode,
    scheduledAt,
    deliveryDetails,
  } = req.body;

  await ensureCustomerHasNoActiveRequest(req.accountId);

  await assertNoActiveRestriction({
    accountId: req.accountId,
    restrictionTypes: ["app_usage", "creating_requests"],
  });

  const vehicle = await Vehicle.findOne({
    code: vehicleTypeCode.toString().trim().toLowerCase(),
    isActive: true,
  });

  if (!vehicle) {
    const error = new Error("نوع المركبة غير موجود أو غير مفعل");
    error.statusCode = 404;
    throw error;
  }

  if (!vehicle.allowedServices.includes(serviceType)) {
    const error = new Error("نوع المركبة لا يدعم هذا النوع من الطلبات");
    error.statusCode = 400;
    throw error;
  }

  let scheduledDate = null;

  if (serviceType === "scheduled_ride") {
    if (!scheduledAt) {
      const error = new Error("وقت الحجز مطلوب");
      error.statusCode = 400;
      throw error;
    }

    scheduledDate = new Date(scheduledAt);

    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      const error = new Error("وقت الحجز يجب أن يكون في المستقبل");
      error.statusCode = 400;
      throw error;
    }

    scheduledDate = await assertScheduledRideLeadTime({ scheduledAt });
  }

  if (serviceType === "delivery_order") {
    if (!deliveryDetails?.itemDescription) {
      const error = new Error("وصف الطلب مطلوب");
      error.statusCode = 400;
      throw error;
    }

    if (!destination?.address || destination.lat === undefined || destination.lng === undefined) {
      const error = new Error("وجهة تسليم الطلب مطلوبة");
      error.statusCode = 400;
      throw error;
    }
  }

  const estimatedPrice = calculateEstimatedPrice({
    vehicle,
    distanceKm,
  });

  const initialCustomerPrice =
    customerOfferedPrice !== undefined && customerOfferedPrice !== null
      ? Number(customerOfferedPrice)
      : estimatedPrice;

  if (initialCustomerPrice <= 0) {
    const error = new Error("السعر المعروض من العميل غير صحيح");
    error.statusCode = 400;
    throw error;
  }

  let customerPromoResult = null;

  if (customerPromoCode) {
    customerPromoResult = await validatePromoCode({
      code: customerPromoCode,
      promoType: "customer",
      accountId: req.accountId,
      serviceType,
      vehicleTypeCode: vehicle.code,
      amount: initialCustomerPrice,
    });
  }

  const customerDiscountAmount = roundMoney(
    customerPromoResult?.discountAmount || 0,
  );

  const customerPayablePrice = roundMoney(
    Math.max(initialCustomerPrice - customerDiscountAmount, 0),
  );

  const lifecycleDates = await buildRequestLifecycleDates({
    serviceType,
    scheduledAt: scheduledDate || scheduledAt,
  });

  const doc = await ServiceRequest.create({
    requestCode: generateRequestCode(),
    serviceType,
    customerAccountId: req.accountId,

    vehicleTypeId: vehicleTypeId || vehicle._id,
    vehicleTypeCode: vehicle.code,
    vehicleTypeName: vehicleTypeName || vehicle.name,

    pickup,
    pickupLocation: buildGeoPoint({
      lat: pickup.lat,
      lng: pickup.lng,
    }),

    searchRadiusKm: await getSearchRadiusKmByServiceType(serviceType),

    destination: destination || {},

    distanceKm: Number(distanceKm) || 0,
    estimatedPrice,
    customerOfferedPrice: roundMoney(initialCustomerPrice),
    customerPromoCodeId: customerPromoResult?.promo?._id || null,
    customerPromoCode: customerPromoResult?.promo?.code || "",
    customerPromoSnapshot: customerPromoResult?.snapshot || null,
    customerDiscountAmount,
    appCoveredDiscountAmount: customerDiscountAmount,
    customerPayablePrice,

    scheduledAt: serviceType === "scheduled_ride" ? scheduledDate : null,
    dispatchAt: lifecycleDates.dispatchAt,
    dispatchedAt: lifecycleDates.dispatchedAt,
    dispatchStatus: lifecycleDates.dispatchStatus,
    requestExpiresAt: lifecycleDates.requestExpiresAt,

    deliveryDetails:
      serviceType === "delivery_order"
        ? buildDeliveryDetailsPayload(deliveryDetails)
        : undefined,

    status: "pending_offers",
  });

  if (customerPromoResult?.promo) {
    await reserveCustomerPromoForRequest({
      promo: customerPromoResult.promo,
      accountId: req.accountId,
      serviceRequestId: doc._id,
      amount: initialCustomerPrice,
      discountAmount: customerDiscountAmount,
    });
  }

  let nearbyDriversCount = 0;

  safeSocketEmit(() => {
    const requestPayload = { request: doc };
    emitToAccount(req.accountId, "request:created", requestPayload);
    emitToAdmins("admin:request-created", {
      request: doc,
      nearbyDriversCount,
      dispatchStatus: doc.dispatchStatus,
    });
  });

  if (doc.dispatchStatus === "dispatched") {
    const dispatchResult = await dispatchServiceRequestToNearbyDrivers({
      request: doc,
      reason: serviceType === "scheduled_ride"
        ? "scheduled_request_created_immediate_dispatch"
        : "request_created",
      notifyCustomer: false,
    });

    nearbyDriversCount = dispatchResult.driversCount || 0;
  }

  await safeCreateNotification({
    accountId: req.accountId,
    title: "تم إنشاء الطلب",
    body: serviceType === "scheduled_ride"
      ? "تم إرسال الحجز بموعد للسائقين المؤهلين وفي انتظار قبول أحد السائقين"
      : "تم إنشاء طلبك بنجاح وفي انتظار عروض السائقين",
    type: "request",
    data: {
      serviceRequestId: doc._id,
      requestCode: doc.requestCode,
      serviceType: doc.serviceType,
      status: doc.status,
    },
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: serviceType === "scheduled_ride"
      ? "تم إنشاء الحجز وإرساله للسائقين المؤهلين"
      : serviceType === "delivery_order"
        ? "تم إنشاء طلب التوصيل بنجاح وفي انتظار عروض السائقين"
        : "تم إنشاء الطلب بنجاح وفي انتظار عروض السائقين",
    doc,
  });
});

const getMyServiceRequests = asyncHandler(async (req, res) => {
  const { as } = req.query;

  const query =
    as === "driver"
      ? { acceptedDriverAccountId: req.accountId }
      : { customerAccountId: req.accountId };

  const baseDocs = await ServiceRequest.find(query)
    .sort({ createdAt: -1 })
    .select("_id status acceptedDriverAccountId customerAccountId");

  const docs = [];

  for (const item of baseDocs) {
    const includeContactInfo =
      confirmedStatuses.includes(item.status) && !!item.acceptedDriverAccountId;

    const enriched = await loadEnrichedRequestById({
      requestId: item._id,
      includeContactInfo,
    });

    if (enriched) {
      docs.push(enriched);
    }
  }

  return sendSuccess({
    res,
    message: "تم جلب الطلبات بنجاح",
    docs,
  });
});

const getAvailableServiceRequestsForDriver = asyncHandler(async (req, res) => {
  if (!req.roles?.includes("driver")) {
    const error = new Error("هذا المسار متاح للسائق فقط");
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await ensureDriverCanWork(req.accountId, {
    silentActiveRequest: true,
  });

  if (driverProfile.$locals?.hasActiveRequestConflict) {
    return sendSuccess({
      res,
      message: "السائق لديه طلب نشط حاليًا",
      docs: [],
    });
  }

  if (
    driverProfile.currentLat === null ||
    driverProfile.currentLng === null ||
    !driverProfile.currentLocation?.coordinates?.length
  ) {
    return sendSuccess({
      res,
      message: "لا توجد طلبات متاحة لأن موقع السائق غير محدد",
      docs: [],
    });
  }

  const vehicleQuery = {
    accountId: req.accountId,
    isActive: true,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const driverVehicles = await DriverVehicle.find(vehicleQuery);

  const vehicleCodes = driverVehicles
    .map((vehicle) => vehicle.vehicleTypeCode)
    .filter(Boolean);

  if (vehicleCodes.length === 0) {
    return sendSuccess({
      res,
      message: "لا توجد مركبات متاحة لهذا السائق",
      docs: [],
    });
  }

  const { serviceType } = req.query;

  const query = {
    customerAccountId: { $ne: req.accountId },
    status: { $in: ["pending_offers", "negotiating"] },
    $or: [
      { serviceType: { $ne: "scheduled_ride" } },
      { dispatchStatus: "dispatched" },
    ],
    vehicleTypeCode: { $in: vehicleCodes },
    pickupLocation: {
      $near: {
        $geometry: driverProfile.currentLocation,
        $maxDistance: 100 * 1000,
      },
    },
  };

  if (serviceType) {
    query.serviceType = serviceType;
  }

  const requests = await ServiceRequest.find(query).limit(100);

  const docs = requests
    .map((request) => {
      const distanceFromDriverKm = calculateDistanceKm({
        lat1: driverProfile.currentLat,
        lng1: driverProfile.currentLng,
        lat2: request.pickup.lat,
        lng2: request.pickup.lng,
      });

      return {
        ...request.toObject(),
        distanceFromDriverKm,
      };
    })
    .filter((request) => {
      return (
        request.distanceFromDriverKm <= Number(request.searchRadiusKm || 5)
      );
    })
    .sort((a, b) => a.distanceFromDriverKm - b.distanceFromDriverKm);

  return sendSuccess({
    res,
    message: "تم جلب الطلبات القريبة المتاحة للسائق بنجاح",
    docs,
  });
});
const accountPublicFields = "name profileImage image photo avatar";
const accountContactFields = "name phone profileImage image photo avatar";

const driverVehiclePublicFields =
  "vehicleTypeCode vehicleTypeName plateNumber vehicleNumber vehicleImage image photo vehiclePhoto carImage brand model color";

const confirmedStatuses = [
  "offer_accepted",
  "driver_arriving",
  "arrived_to_pickup",
  "in_progress",
  "completed",
];

const activeCustomerRequestStatuses = [
  "pending_offers",
  "negotiating",
  "offer_accepted",
  "driver_arriving",
  "arrived_to_pickup",
  "in_progress",
];

const openOfferRequestStatuses = ["pending_offers", "negotiating"];
const terminalRequestStatuses = [
  "completed",
  "cancelled_by_customer",
  "cancelled_by_driver",
  "cancelled_by_admin",
  "expired",
  "driver_no_show",
  "customer_no_show",
];

const requestStatusTransitions = {
  pending_offers: ["negotiating", "cancelled_by_customer", "expired"],
  negotiating: ["cancelled_by_customer", "offer_accepted", "expired"],
  offer_accepted: ["driver_arriving", "cancelled_by_customer", "cancelled_by_driver"],
  driver_arriving: [
    "arrived_to_pickup",
    "cancelled_by_customer",
    "cancelled_by_driver",
    "driver_no_show",
  ],
  arrived_to_pickup: [
    "in_progress",
    "cancelled_by_customer",
    "cancelled_by_driver",
    "customer_no_show",
  ],
  in_progress: ["completed", "cancelled_by_customer", "cancelled_by_driver"],
};

const assertStatusTransitionAllowed = ({ currentStatus, nextStatus }) => {
  if (currentStatus === nextStatus) {
    const error = new Error("الطلب موجود بالفعل على نفس الحالة");
    error.statusCode = 400;
    throw error;
  }

  if (terminalRequestStatuses.includes(currentStatus)) {
    const error = new Error("لا يمكن تحديث طلب منتهي أو ملغي");
    error.statusCode = 400;
    throw error;
  }

  const allowedNextStatuses = requestStatusTransitions[currentStatus] || [];

  if (!allowedNextStatuses.includes(nextStatus)) {
    const error = new Error(
      `لا يمكن نقل الطلب من الحالة ${currentStatus} إلى ${nextStatus}`,
    );
    error.statusCode = 400;
    throw error;
  }
};

const buildAcceptanceLockFilter = (requestId) => {
  const staleLockDate = new Date(Date.now() - 2 * 60 * 1000);

  return {
    _id: requestId,
    status: { $in: openOfferRequestStatuses },
    acceptedOfferId: null,
    $or: [
      { lifecycleLockToken: null },
      { lifecycleLockToken: "" },
      { lifecycleLockedAt: { $lt: staleLockDate } },
    ],
  };
};

const releaseRequestLifecycleLock = async ({ requestId, lockToken }) => {
  if (!requestId || !lockToken) return;

  await ServiceRequest.updateOne(
    {
      _id: requestId,
      lifecycleLockToken: lockToken,
    },
    {
      $set: {
        lifecycleLockReason: "",
      },
      $unset: {
        lifecycleLockToken: "",
        lifecycleLockedAt: "",
      },
    },
  );
};

const assertRequestNotLifecycleLocked = (request) => {
  if (!request?.lifecycleLockToken) return;

  const lockedAt = request.lifecycleLockedAt
    ? new Date(request.lifecycleLockedAt).getTime()
    : 0;

  const isFreshLock = lockedAt && Date.now() - lockedAt < 2 * 60 * 1000;

  if (isFreshLock) {
    const error = new Error("يتم تأكيد عرض على هذا الطلب الآن، حاول مرة أخرى بعد لحظات");
    error.statusCode = 409;
    throw error;
  }
};

const releaseDriverFromRequest = async ({ driverAccountId, requestId }) => {
  if (!driverAccountId || !requestId) return;

  await DriverProfile.findOneAndUpdate(
    {
      accountId: driverAccountId,
      activeServiceRequestId: requestId,
    },
    {
      activeServiceRequestId: null,
      currentVehicleId: null,
      isAvailable: true,
    },
  );
};

const closePendingOffersBecauseAccepted = async ({
  requestId,
  acceptedOfferId,
}) => {
  const pendingOffers = await ServiceOffer.find({
    serviceRequestId: requestId,
    _id: { $ne: acceptedOfferId },
    status: "pending",
  }).select("driverAccountId sentBy offeredPrice");

  await ServiceOffer.updateMany(
    {
      serviceRequestId: requestId,
      _id: { $ne: acceptedOfferId },
      status: "pending",
    },
    {
      status: "rejected",
      rejectedAt: new Date(),
      closedAt: new Date(),
      closedBy: "system",
      closedReason: "تم إغلاق العرض بسبب قبول عرض آخر لنفس الطلب",
    },
  );

  return pendingOffers;
};

const emitClosedOffersAfterAcceptance = async ({
  request,
  acceptedOffer,
  closedOffers,
}) => {
  const closedDriverAccountIds = [
    ...new Set(
      closedOffers
        .map((offer) => offer.driverAccountId?.toString())
        .filter(
          (accountId) =>
            accountId &&
            accountId !== acceptedOffer.driverAccountId.toString(),
        ),
    ),
  ];

  safeSocketEmit(() => {
    for (const driverAccountId of closedDriverAccountIds) {
      emitToAccount(driverAccountId, "offer:closed", {
        requestId: request._id,
        serviceRequestId: request._id,
        reason: "other_driver_accepted",
        message: "تم إغلاق الطلب لأن العميل قبل عرض سائق آخر",
      });

      emitToAccount(driverAccountId, "request:removed", {
        requestId: request._id,
        serviceRequestId: request._id,
        reason: "other_driver_accepted",
        message: "تم إزالة الطلب لأن العميل قبل عرض سائق آخر",
      });
    }

    if (request.vehicleTypeCode) {
      emitToVehicle(request.vehicleTypeCode, "request:closed", {
        requestId: request._id,
        serviceRequestId: request._id,
        reason: "other_driver_accepted",
      });
    }
  });

  setImmediate(() => {
    for (const driverAccountId of closedDriverAccountIds) {
      safeCreateNotification({
        accountId: driverAccountId,
        title: "تم إغلاق الطلب",
        body: "تم إغلاق الطلب لأن العميل قبل عرض سائق آخر",
        type: "offer",
        data: {
          serviceRequestId: request._id,
          reason: "other_driver_accepted",
        },
      });
    }
  });
};

const acceptPendingOfferSafely = async ({
  requestId,
  offerId,
  actorAccountId,
  acceptedBy,
}) => {
  const request = await ensureRequestExists(requestId);

  if (!openOfferRequestStatuses.includes(request.status)) {
    const error = new Error("لا يمكن قبول عرض على هذا الطلب حاليًا");
    error.statusCode = 400;
    throw error;
  }

  assertRequestCanReceiveDriverActivity(request);

  if (request.acceptedOfferId || request.acceptedDriverAccountId) {
    const error = new Error("تم قبول عرض لهذا الطلب بالفعل");
    error.statusCode = 409;
    throw error;
  }

  if (acceptedBy === "customer" && request.customerAccountId.toString() !== actorAccountId) {
    const error = new Error("العميل صاحب الطلب فقط يمكنه قبول العرض");
    error.statusCode = 403;
    throw error;
  }

  const expectedSentBy = acceptedBy === "customer" ? "driver" : "customer";

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: "pending",
    sentBy: expectedSentBy,
  });

  if (!offer) {
    const error = new Error("العرض غير موجود أو لم يعد متاحًا");
    error.statusCode = 404;
    throw error;
  }

  assertOfferStillValid(offer);

  if (acceptedBy === "driver" && offer.driverAccountId.toString() !== actorAccountId) {
    const error = new Error("السائق صاحب العرض فقط يمكنه قبول السعر المضاد");
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await ensureDriverCanWork(offer.driverAccountId.toString(), {
    currentRequestId: request._id,
  });

  const acceptedDriverVehicle = await DriverVehicle.findOne({
    _id: offer.driverVehicleId,
    accountId: offer.driverAccountId,
    vehicleTypeCode: request.vehicleTypeCode,
    isActive: true,
    isApproved: true,
    reviewStatus: "approved",
  });

  if (!acceptedDriverVehicle) {
    const error = new Error("مركبة السائق لم تعد صالحة لهذا الطلب");
    error.statusCode = 400;
    throw error;
  }

  const lockToken = crypto.randomUUID();
  let driverLocked = false;

  const lockedRequest = await ServiceRequest.findOneAndUpdate(
    buildAcceptanceLockFilter(request._id),
    {
      lifecycleLockToken: lockToken,
      lifecycleLockReason: "accept_offer",
      lifecycleLockedAt: new Date(),
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!lockedRequest) {
    const error = new Error("تم قبول عرض آخر أو الطلب لم يعد متاحًا");
    error.statusCode = 409;
    throw error;
  }

  try {
    const lockedDriverProfile = await DriverProfile.findOneAndUpdate(
      {
        _id: driverProfile._id,
        isActive: true,
        isOnline: true,
        isApproved: true,
        reviewStatus: "approved",
        isBlockedForDebt: false,
        $or: [
          {
            activeServiceRequestId: null,
            isAvailable: true,
          },
          {
            activeServiceRequestId: request._id,
          },
        ],
        $expr: {
          $lt: ["$commissionDebt", "$commissionDebtLimit"],
        },
      },
      {
        activeServiceRequestId: request._id,
        currentVehicleId: offer.driverVehicleId,
        isAvailable: false,
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (!lockedDriverProfile) {
      const error = new Error("السائق لم يعد متاحًا لهذا الطلب");
      error.statusCode = 409;
      throw error;
    }

    driverLocked = true;

    const vehicle = await Vehicle.findOne({
      code: request.vehicleTypeCode,
    });

    const commissionPercent = getCommissionPercent(vehicle, request.serviceType);
    const finalPrice = roundMoney(offer.offeredPrice);
    const grossCommissionAmount = roundMoney((finalPrice * commissionPercent) / 100);
    const acceptedAt = new Date();

    offer.status = "accepted";
    offer.acceptedAt = acceptedAt;
    offer.closedAt = acceptedAt;
    offer.closedBy = acceptedBy;
    offer.closedReason = "تم قبول العرض وتأكيد الطلب";
    await offer.save();

    const closedOffers = await closePendingOffersBecauseAccepted({
      requestId: request._id,
      acceptedOfferId: offer._id,
    });

    await ServiceRequest.updateOne(
      {
        _id: request._id,
        lifecycleLockToken: lockToken,
      },
      {
        $set: {
          status: "offer_accepted",
          acceptedDriverAccountId: offer.driverAccountId,
          acceptedDriverVehicleId: offer.driverVehicleId,
          acceptedOfferId: offer._id,
          finalPrice,
          customerPayablePrice: roundMoney(
            Math.max(finalPrice - Number(request.customerDiscountAmount || 0), 0),
          ),
          commissionPercent,
          grossCommissionAmount,
          driverPromoCodeId: offer.driverPromoCodeId || null,
          driverPromoCode: offer.driverPromoCode || "",
          driverPromoSnapshot: offer.driverPromoSnapshot || null,
          driverPromoDiscountAmount: 0,
          commissionAmount: grossCommissionAmount,
          confirmedAt: acceptedAt,
          lastStatusChangedAt: acceptedAt,
          lifecycleLockReason: "",
        },
        $unset: {
          lifecycleLockToken: "",
          lifecycleLockedAt: "",
        },
      },
      {
        runValidators: true,
      },
    );

    const acceptedRequest = await ServiceRequest.findById(request._id);

    const acceptedRequestId = acceptedRequest._id.toString();
    const acceptanceLivePayload = {
      request: {
        ...acceptedRequest.toObject({ depopulate: true }),
        _id: acceptedRequest._id,
        id: acceptedRequestId,
        requestId: acceptedRequestId,
      },
      offer: {
        ...offer.toObject({ depopulate: true }),
        _id: offer._id,
        id: offer._id.toString(),
      },
      requestId: acceptedRequestId,
      serviceRequestId: acceptedRequestId,
      status: acceptedRequest.status,
      acceptedBy,
      emittedAt: new Date(),
    };

    // Notify both phones immediately after the acceptance is committed. Chat
    // room creation, populate/rating queries and push notifications continue
    // afterwards without delaying the live transition to the trip screens.
    safeSocketEmit(() => {
      emitToRooms(
        [
          getRequestRoom(acceptedRequestId),
          getAccountRoom(request.customerAccountId.toString()),
          getAccountRoom(offer.driverAccountId.toString()),
        ],
        "request:confirmed-live",
        acceptanceLivePayload,
      );
      emitToAdmins("admin:request-confirmed-live", acceptanceLivePayload);
    });

    if (offer.driverPromoCodeId) {
      await reserveDriverPromoForAcceptedOffer({
        promoCodeId: offer.driverPromoCodeId,
        code: offer.driverPromoCode,
        accountId: offer.driverAccountId,
        serviceRequestId: acceptedRequest._id,
        serviceOfferId: offer._id,
        estimatedDiscountAmount: offer.estimatedDriverPromoDiscountAmount,
      });
    }

    const chatRoom = await createChatRoomForAcceptedRequest({
      request: acceptedRequest,
      offer,
    });

    const acceptedRequestForParties = await loadEnrichedRequestById({
      requestId: acceptedRequest._id,
      includeContactInfo: true,
    });

    const acceptedRequestPublic = await loadEnrichedRequestById({
      requestId: acceptedRequest._id,
      includeContactInfo: false,
    });

    const acceptedOfferForResponse =
      (await loadEnrichedOfferById(offer._id)) || offer;

    safeSocketEmit(() => {
      if (acceptedBy === "customer") {
        emitToAccount(offer.driverAccountId.toString(), "offer:accepted", {
          request: acceptedRequestForParties,
          offer: acceptedOfferForResponse,
          chatRoom,
        });

        emitToAccount(request.customerAccountId.toString(), "request:confirmed", {
          request: acceptedRequestForParties,
          offer: acceptedOfferForResponse,
          chatRoom,
        });
      } else {
        emitToAccount(
          request.customerAccountId.toString(),
          "offer:accepted-by-driver",
          {
            request: acceptedRequestForParties,
            offer: acceptedOfferForResponse,
            chatRoom,
          },
        );

        emitToAccount(offer.driverAccountId.toString(), "request:confirmed", {
          request: acceptedRequestForParties,
          offer: acceptedOfferForResponse,
          chatRoom,
        });
      }

      emitToRequest(acceptedRequest._id.toString(), "request:confirmed", {
        request: acceptedRequestPublic,
        offer: acceptedOfferForResponse,
        chatRoom,
      });

      emitToAccount(request.customerAccountId.toString(), "chat:room-created", {
        requestId: acceptedRequest._id,
        serviceRequestId: acceptedRequest._id,
        room: chatRoom,
      });

      emitToAccount(offer.driverAccountId.toString(), "chat:room-created", {
        requestId: acceptedRequest._id,
        serviceRequestId: acceptedRequest._id,
        room: chatRoom,
      });

      emitToAdmins("admin:request-confirmed", {
        request: acceptedRequestForParties,
        offer: acceptedOfferForResponse,
        chatRoom,
      });
    });

    await emitClosedOffersAfterAcceptance({
      request: acceptedRequest,
      acceptedOffer: offer,
      closedOffers,
    });

    await safeCreateNotification({
      accountId: request.customerAccountId,
      title: acceptedBy === "customer" ? "تم تأكيد الطلب" : "السائق وافق على السعر",
      body:
        acceptedBy === "customer"
          ? `تم قبول العرض وتأكيد الطلب بسعر ${acceptedRequest.finalPrice} جنيه`
          : `السائق وافق على السعر ${acceptedRequest.finalPrice} جنيه وتم تأكيد الطلب`,
      type: "request",
      data: {
        serviceRequestId: acceptedRequest._id,
        offerId: offer._id,
        finalPrice: acceptedRequest.finalPrice,
      },
    });

    await safeCreateNotification({
      accountId: offer.driverAccountId,
      title: acceptedBy === "customer" ? "تم قبول عرضك" : "تم تأكيد الطلب",
      body:
        acceptedBy === "customer"
          ? `العميل قبل عرضك بسعر ${acceptedRequest.finalPrice} جنيه`
          : `تم تأكيد الطلب بسعر ${acceptedRequest.finalPrice} جنيه`,
      type: acceptedBy === "customer" ? "offer" : "request",
      data: {
        serviceRequestId: acceptedRequest._id,
        offerId: offer._id,
        finalPrice: acceptedRequest.finalPrice,
      },
    });

    return {
      request: acceptedRequestForParties,
      acceptedOffer: acceptedOfferForResponse,
      chatRoom,
    };
  } catch (error) {
    await releaseRequestLifecycleLock({
      requestId: request._id,
      lockToken,
    });

    if (driverLocked) {
      await releaseDriverFromRequest({
        driverAccountId: offer.driverAccountId,
        requestId: request._id,
      });
    }

    throw error;
  }
};

const ensureCustomerHasNoActiveRequest = async (accountId) => {
  const activeRequest = await ServiceRequest.findOne({
    customerAccountId: accountId,
    status: { $in: activeCustomerRequestStatuses },
    $or: [
      { serviceType: { $ne: "scheduled_ride" } },
      { serviceType: "scheduled_ride", dispatchStatus: "dispatched" },
      { serviceType: "scheduled_ride", status: { $in: confirmedStatuses } },
    ],
  })
    .select("_id requestCode status serviceType dispatchStatus scheduledAt")
    .lean();

  if (!activeRequest) return;

  const error = new Error(
    "لديك طلب نشط بالفعل. لا يمكن إنشاء طلب جديد قبل إنهاء أو إلغاء الطلب الحالي",
  );
  error.statusCode = 409;
  error.activeRequest = activeRequest;
  throw error;
};

const toPlainObject = (doc) => {
  if (!doc) return null;

  return doc.toObject && typeof doc.toObject === "function"
    ? doc.toObject()
    : { ...doc };
};


const attachAccountImageUrls = (accountObject) => {
  if (!accountObject) return accountObject;

  const raw = toPlainObject(accountObject);
  const profileImage = firstNonEmptyValue(
    raw.profileImage,
    raw.image,
    raw.photo,
    raw.avatar,
  );

  return {
    ...raw,
    profileImage: raw.profileImage || profileImage,
    profileImageUrl: buildPublicUrl(profileImage),
  };
};

const attachVehicleImageUrls = (vehicleObject) => {
  if (!vehicleObject) return vehicleObject;

  const raw = toPlainObject(vehicleObject);
  const vehicleImage = firstNonEmptyValue(
    raw.vehicleImage,
    raw.vehiclePhoto,
    raw.carImage,
    raw.image,
    raw.photo,
  );

  return {
    ...raw,
    vehicleImage: raw.vehicleImage || vehicleImage,
    vehicleImageUrl: buildPublicUrl(vehicleImage),
    licenseImageUrl: buildPublicUrl(raw.licenseImage),
  };
};

const buildAccountRatingSummary = async (accountId) => {
  if (!accountId) {
    return {
      ratingAverage: 0,
      ratingCount: 0,
    };
  }

  const stats = await Rating.aggregate([
    {
      $match: {
        toAccountId: new mongoose.Types.ObjectId(accountId),
      },
    },
    {
      $group: {
        _id: "$toAccountId",
        ratingAverage: { $avg: "$stars" },
        ratingCount: { $sum: 1 },
      },
    },
  ]);

  if (!stats.length) {
    return {
      ratingAverage: 0,
      ratingCount: 0,
    };
  }

  return {
    ratingAverage: Math.round((stats[0].ratingAverage || 0) * 10) / 10,
    ratingCount: stats[0].ratingCount || 0,
  };
};

const enrichAccountObject = async (accountObject) => {
  if (!accountObject) return accountObject;

  const raw = toPlainObject(accountObject);
  const accountId = raw._id || raw.id || null;
  const rating = await buildAccountRatingSummary(accountId);

  return {
    ...attachAccountImageUrls(raw),
    ratingAverage: rating.ratingAverage,
    ratingCount: rating.ratingCount,
  };
};

const enrichDriverAccountObject = async (accountObject) => {
  if (!accountObject) return accountObject;

  const raw = toPlainObject(accountObject);
  const accountId = raw._id || raw.id || null;

  const [profile, rating] = await Promise.all([
    accountId ? DriverProfile.findOne({ accountId }) : null,
    buildAccountRatingSummary(accountId),
  ]);

  return {
    ...attachAccountImageUrls(raw),
    ratingAverage: profile?.ratingAverage || rating.ratingAverage,
    ratingCount: profile?.ratingCount || rating.ratingCount,
    driverProfile: profile
      ? {
          totalCompletedTrips: profile.totalCompletedTrips || 0,
          ratingAverage: profile.ratingAverage || rating.ratingAverage,
          ratingCount: profile.ratingCount || rating.ratingCount,
        }
      : null,
  };
};

const buildEnrichedOffer = async (offerDoc) => {
  const offer = toPlainObject(offerDoc);

  if (!offer) return null;

  if (offer.driverAccountId && typeof offer.driverAccountId === "object") {
    offer.driverAccountId = await enrichDriverAccountObject(
      offer.driverAccountId,
    );
  }

  if (offer.driverVehicleId && typeof offer.driverVehicleId === "object") {
    offer.driverVehicleId = attachVehicleImageUrls(offer.driverVehicleId);
  }

  return offer;
};

const loadEnrichedOfferById = async (offerId) => {
  const offer = await ServiceOffer.findById(offerId)
    .populate("driverAccountId", accountPublicFields)
    .populate("driverVehicleId", driverVehiclePublicFields);

  if (!offer) return null;

  return buildEnrichedOffer(offer);
};

const loadEnrichedRequestById = async ({
  requestId,
  includeContactInfo = false,
}) => {
  const accountFields = includeContactInfo
    ? accountContactFields
    : accountPublicFields;

  const requestDoc = await ServiceRequest.findById(requestId)
    .populate("customerAccountId", accountFields)
    .populate("acceptedDriverAccountId", accountFields)
    .populate("acceptedDriverVehicleId", driverVehiclePublicFields)
    .populate("vehicleTypeId");

  if (!requestDoc) return null;

  const request = requestDoc.toObject();

  if (
    request.customerAccountId &&
    typeof request.customerAccountId === "object"
  ) {
    request.customerAccountId = await enrichAccountObject(
      request.customerAccountId,
    );
  }

  if (
    request.acceptedDriverAccountId &&
    typeof request.acceptedDriverAccountId === "object"
  ) {
    request.acceptedDriverAccountId = await enrichDriverAccountObject(
      request.acceptedDriverAccountId,
    );
  }

  if (
    request.acceptedDriverVehicleId &&
    typeof request.acceptedDriverVehicleId === "object"
  ) {
    request.acceptedDriverVehicleId = attachVehicleImageUrls(
      request.acceptedDriverVehicleId,
    );
  }

  return request;
};

const canDriverViewOpenRequest = async ({ accountId, request }) => {
  if (!isRequestDispatchedToDrivers(request)) {
    return false;
  }

  if (request.requestExpiresAt && new Date(request.requestExpiresAt) <= new Date()) {
    return false;
  }

  const driverProfile = await ensureDriverCanWork(accountId);

  const vehicleQuery = {
    accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const matchingVehicle = await DriverVehicle.exists(vehicleQuery);

  if (!matchingVehicle) {
    return false;
  }

  if (
    driverProfile.currentLat === null ||
    driverProfile.currentLng === null ||
    request.pickup?.lat === undefined ||
    request.pickup?.lng === undefined ||
    request.pickup?.lat === null ||
    request.pickup?.lng === null
  ) {
    return false;
  }

  const distanceFromDriverKm = calculateDistanceKm({
    lat1: driverProfile.currentLat,
    lng1: driverProfile.currentLng,
    lat2: request.pickup.lat,
    lng2: request.pickup.lng,
  });

  return distanceFromDriverKm <= Number(request.searchRadiusKm || 5);
};

const getServiceRequestById = asyncHandler(async (req, res) => {
  const baseRequest = await ensureRequestExists(req.params.id);

  const isCustomer = baseRequest.customerAccountId.toString() === req.accountId;
  const isAcceptedDriver =
    baseRequest.acceptedDriverAccountId?.toString() === req.accountId;
  const isDriver = req.roles?.includes("driver");
  const isAdmin = req.roles?.includes("admin");

  const isOpenForDrivers =
    baseRequest.status === "pending_offers" ||
    baseRequest.status === "negotiating";

  let canDriverViewOpen = false;

  if (
    !isCustomer &&
    !isAcceptedDriver &&
    !isAdmin &&
    isDriver &&
    isOpenForDrivers
  ) {
    canDriverViewOpen = await canDriverViewOpenRequest({
      accountId: req.accountId,
      request: baseRequest,
    });
  }

  if (!isCustomer && !isAcceptedDriver && !isAdmin && !canDriverViewOpen) {
    const error = new Error("غير مسموح لك بعرض هذا الطلب");
    error.statusCode = 403;
    throw error;
  }

  const isConfirmedRequest =
    confirmedStatuses.includes(baseRequest.status) &&
    !!baseRequest.acceptedDriverAccountId;

  const canSeeContactInfo =
    isAdmin || (isConfirmedRequest && (isCustomer || isAcceptedDriver));

  const request = await loadEnrichedRequestById({
    requestId: baseRequest._id,
    includeContactInfo: canSeeContactInfo,
  });

  const offerDocs = await ServiceOffer.find({
    serviceRequestId: baseRequest._id,
  })
    .populate("driverAccountId", accountPublicFields)
    .populate("driverVehicleId", driverVehiclePublicFields)
    .sort({
      createdAt: -1,
    });

  const offers = [];

  for (const offerDoc of offerDocs) {
    const enrichedOffer = await buildEnrichedOffer(offerDoc);

    if (enrichedOffer) {
      offers.push(enrichedOffer);
    }
  }

  const acceptedOffer =
    offers.find((offer) => {
      return (
        offer._id?.toString() === request.acceptedOfferId?.toString() ||
        offer.status === "accepted"
      );
    }) || null;

  return sendSuccess({
    res,
    message: "تم جلب تفاصيل الطلب بنجاح",
    doc: {
      request,
      offers,
      acceptedOffer,
    },
  });
});

const getRequestOffers = asyncHandler(async (req, res) => {
  const baseRequest = await ensureRequestExists(req.params.id);

  const isCustomer = baseRequest.customerAccountId.toString() === req.accountId;
  const isAcceptedDriver =
    baseRequest.acceptedDriverAccountId?.toString() === req.accountId;
  const isAdmin = req.roles?.includes("admin");

  if (!isCustomer && !isAcceptedDriver && !isAdmin) {
    const error = new Error("غير مسموح لك بعرض عروض هذا الطلب");
    error.statusCode = 403;
    throw error;
  }

  const query = { serviceRequestId: baseRequest._id };

  if (req.roles?.includes("driver") && !isCustomer && !isAdmin) {
    query.driverAccountId = req.accountId;
  }

  const offerDocs = await ServiceOffer.find(query)
    .populate("driverAccountId", accountPublicFields)
    .populate("driverVehicleId", driverVehiclePublicFields)
    .sort({ createdAt: -1 });

  const docs = [];

  for (const offerDoc of offerDocs) {
    const enrichedOffer = await buildEnrichedOffer(offerDoc);

    if (enrichedOffer) {
      docs.push(enrichedOffer);
    }
  }

  return sendSuccess({
    res,
    message: "تم جلب عروض الطلب بنجاح",
    docs,
  });
});

const getOfferNegotiations = asyncHandler(async (req, res) => {
  const offer = await ServiceOffer.findById(req.params.offerId);

  if (!offer) {
    const error = new Error("العرض غير موجود");
    error.statusCode = 404;
    throw error;
  }

  const request = await ensureRequestExists(offer.serviceRequestId);

  const isCustomer = request.customerAccountId.toString() === req.accountId;
  const isOfferDriver = offer.driverAccountId.toString() === req.accountId;
  const isAcceptedDriver =
    request.acceptedDriverAccountId?.toString() === req.accountId;
  const isAdmin = req.roles?.includes("admin");

  if (!isCustomer && !isOfferDriver && !isAcceptedDriver && !isAdmin) {
    const error = new Error("غير مسموح لك بعرض سجل هذا العرض");
    error.statusCode = 403;
    throw error;
  }

  const rootOfferId = offer.parentOfferId || offer._id;

  const offerDocs = await ServiceOffer.find({
    serviceRequestId: request._id,
    $or: [
      { _id: rootOfferId },
      { parentOfferId: rootOfferId },
      { _id: offer._id },
      { parentOfferId: offer._id },
    ],
  })
    .populate("driverAccountId", accountPublicFields)
    .populate("driverVehicleId", driverVehiclePublicFields)
    .sort({ createdAt: 1 });

  const docs = [];

  for (const offerDoc of offerDocs) {
    const enrichedOffer = await buildEnrichedOffer(offerDoc);

    if (enrichedOffer) {
      docs.push(enrichedOffer);
    }
  }

  return sendSuccess({
    res,
    message: "تم جلب سجل التفاوض بنجاح",
    docs,
  });
});

const createDriverOffer = asyncHandler(async (req, res) => {
  if (!req.roles?.includes("driver")) {
    const error = new Error("هذا الإجراء متاح للسائق فقط");
    error.statusCode = 403;
    throw error;
  }

  const request = await ensureRequestExists(req.params.id);
  assertRequestNotLifecycleLocked(request);

  if (!["pending_offers", "negotiating"].includes(request.status)) {
    const error = new Error("لا يمكن إرسال عرض على هذا الطلب حاليًا");
    error.statusCode = 400;
    throw error;
  }

  assertRequestCanReceiveDriverActivity(request);

  if (request.customerAccountId.toString() === req.accountId) {
    const error = new Error("لا يمكن للسائق إرسال عرض على طلبه الشخصي");
    error.statusCode = 400;
    throw error;
  }

  await ensureDriverCanWork(req.accountId);

  const { driverVehicleId, offeredPrice, message, driverPromoCode } = req.body;

  const vehicleQuery = {
    _id: driverVehicleId,
    accountId: req.accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  vehicleQuery.isApproved = true;
  vehicleQuery.reviewStatus = "approved";

  const driverVehicle = await DriverVehicle.findOne(vehicleQuery);

  if (!driverVehicle) {
    const error = new Error("مركبة السائق غير صالحة لهذا الطلب");
    error.statusCode = 400;
    throw error;
  }

  const price = Number(offeredPrice);

  if (price <= 0) {
    const error = new Error("السعر المعروض غير صحيح");
    error.statusCode = 400;
    throw error;
  }

  let driverPromoResult = null;

  if (driverPromoCode) {
    const vehicleForCommission = await Vehicle.findOne({
      code: request.vehicleTypeCode,
    });
    const estimatedCommissionPercent = getCommissionPercent(
      vehicleForCommission,
      request.serviceType,
    );
    const estimatedCommissionAmount = roundMoney(
      (price * estimatedCommissionPercent) / 100,
    );

    driverPromoResult = await validatePromoCode({
      code: driverPromoCode,
      promoType: "driver",
      accountId: req.accountId,
      serviceType: request.serviceType,
      vehicleTypeCode: request.vehicleTypeCode,
      amount: estimatedCommissionAmount,
      includeReserved: false,
    });
  }

  const pendingCustomerCounter = await ServiceOffer.findOne({
    serviceRequestId: request._id,
    driverAccountId: req.accountId,
    status: "pending",
    sentBy: "customer",
  }).sort({ createdAt: -1 });

  if (pendingCustomerCounter) {
    await ServiceOffer.updateMany(
      {
        serviceRequestId: request._id,
        driverAccountId: req.accountId,
        status: "pending",
        sentBy: "customer",
      },
      {
        status: "cancelled",
        expiredAt: new Date(),
      },
    );
  }

  let offer = await ServiceOffer.findOne({
    serviceRequestId: request._id,
    driverAccountId: req.accountId,
    status: "pending",
    sentBy: "driver",
  });

  if (offer) {
    offer.driverVehicleId = driverVehicle._id;
    offer.offeredPrice = roundMoney(price);
    offer.message = message || "";
    offer.driverPromoCodeId = driverPromoResult?.promo?._id || null;
    offer.driverPromoCode = driverPromoResult?.promo?.code || "";
    offer.driverPromoSnapshot = driverPromoResult?.snapshot || null;
    offer.estimatedDriverPromoDiscountAmount = roundMoney(
      driverPromoResult?.discountAmount || 0,
    );
    offer.parentOfferId = pendingCustomerCounter?._id || offer.parentOfferId;
    offer.expiresAt = await getOfferExpiryDate();
    await offer.save();
  } else {
    offer = await ServiceOffer.create({
      serviceRequestId: request._id,
      driverAccountId: req.accountId,
      driverVehicleId: driverVehicle._id,
      offeredPrice: roundMoney(price),
      message: message || "",
      driverPromoCodeId: driverPromoResult?.promo?._id || null,
      driverPromoCode: driverPromoResult?.promo?.code || "",
      driverPromoSnapshot: driverPromoResult?.snapshot || null,
      estimatedDriverPromoDiscountAmount: roundMoney(
        driverPromoResult?.discountAmount || 0,
      ),
      status: "pending",
      sentBy: "driver",
      parentOfferId: pendingCustomerCounter?._id || null,
      expiresAt: await getOfferExpiryDate(),
    });
  }

  request.status = "negotiating";
  await request.save();

  const enrichedOffer = await loadEnrichedOfferById(offer._id);
  const offerForResponse = enrichedOffer || offer;

  safeSocketEmit(() => {
    emitToAccount(request.customerAccountId.toString(), "offer:new", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });

    emitToRequest(request._id.toString(), "offer:new", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });

    emitToAdmins("admin:offer-created", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: "عرض جديد على طلبك",
    body: `وصلك عرض جديد بسعر ${offer.offeredPrice} جنيه`,
    type: "offer",
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      offeredPrice: offer.offeredPrice,
    },
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: "تم إرسال العرض للعميل بنجاح",
    doc: offerForResponse,
  });
});

const acceptOffer = asyncHandler(async (req, res) => {
  const result = await acceptPendingOfferSafely({
    requestId: req.params.id,
    offerId: req.params.offerId,
    actorAccountId: req.accountId,
    acceptedBy: "customer",
  });

  return sendSuccess({
    res,
    message: "تم قبول العرض وتأكيد الطلب بنجاح",
    doc: result,
  });
});

const createCustomerCounterOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);
  assertRequestNotLifecycleLocked(request);

  if (!["pending_offers", "negotiating"].includes(request.status)) {
    const error = new Error("لا يمكن إرسال سعر مضاد على هذا الطلب حاليًا");
    error.statusCode = 400;
    throw error;
  }

  assertRequestCanReceiveDriverActivity(request);

  const { offerId } = req.params;
  const { offeredPrice, counterPrice, message } = req.body;

  const parentOffer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: "pending",
  });

  if (!parentOffer) {
    const error = new Error("العرض الأصلي غير موجود أو لم يعد متاحًا");
    error.statusCode = 404;
    throw error;
  }

  assertOfferStillValid(parentOffer);

  const isCustomerActor = request.customerAccountId.toString() === req.accountId;
  const isDriverActor = parentOffer.driverAccountId.toString() === req.accountId;

  let sentBy = "";
  let receiverAccountId = null;
  let notificationTitle = "";
  let notificationBody = "";
  let successMessage = "";

  if (isCustomerActor) {
    if (parentOffer.sentBy !== "driver") {
      const error = new Error("يمكن للعميل إرسال سعر مضاد فقط على عرض مرسل من السائق");
      error.statusCode = 400;
      throw error;
    }

    sentBy = "customer";
    receiverAccountId = parentOffer.driverAccountId;
    notificationTitle = "سعر مضاد من العميل";
    successMessage = "تم إرسال السعر المضاد للسائق بنجاح";
  } else if (isDriverActor) {
    if (parentOffer.sentBy !== "customer") {
      const error = new Error("يمكن للسائق إرسال سعر جديد فقط بعد سعر مضاد من العميل");
      error.statusCode = 400;
      throw error;
    }

    sentBy = "driver";
    receiverAccountId = request.customerAccountId;
    notificationTitle = "سعر جديد من السائق";
    successMessage = "تم إرسال السعر الجديد للعميل بنجاح";
  } else {
    const error = new Error("غير مسموح لك بالتفاوض على هذا العرض");
    error.statusCode = 403;
    throw error;
  }

  const price = Number(counterPrice ?? offeredPrice);

  if (price <= 0) {
    const error = new Error("السعر المضاد غير صحيح");
    error.statusCode = 400;
    throw error;
  }

  parentOffer.status = "cancelled";
  parentOffer.closedAt = new Date();
  parentOffer.closedReason = "replaced_by_counter_offer";
  parentOffer.closedBy = sentBy;
  await parentOffer.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: request._id,
      driverAccountId: parentOffer.driverAccountId,
      status: "pending",
      _id: { $ne: parentOffer._id },
    },
    {
      $set: {
        status: "cancelled",
        closedAt: new Date(),
        closedReason: "replaced_by_counter_offer",
        closedBy: sentBy,
      },
    },
  );

  const counterOffer = await ServiceOffer.create({
    serviceRequestId: request._id,
    driverAccountId: parentOffer.driverAccountId,
    driverVehicleId: parentOffer.driverVehicleId,
    offeredPrice: roundMoney(price),
    message: message || "",
    status: "pending",
    sentBy,
    parentOfferId: parentOffer._id,
    expiresAt: await getOfferExpiryDate(),
  });

  request.status = "negotiating";
  await request.save();

  const enrichedCounterOffer = await loadEnrichedOfferById(counterOffer._id);
  const counterOfferForResponse = enrichedCounterOffer || counterOffer;

  notificationBody = sentBy === "customer"
    ? `العميل عرض سعر ${counterOffer.offeredPrice} جنيه`
    : `السائق عرض سعر جديد ${counterOffer.offeredPrice} جنيه`;

  safeSocketEmit(() => {
    emitToAccount(receiverAccountId.toString(), "offer:countered", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });

    emitToAccount(req.accountId, "offer:countered", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });

    emitToRequest(request._id.toString(), "offer:countered", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });

    emitToAdmins("admin:offer-countered", {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });
  });

  await safeCreateNotification({
    accountId: receiverAccountId,
    title: notificationTitle,
    body: notificationBody,
    type: "offer",
    data: {
      serviceRequestId: request._id,
      offerId: counterOffer._id,
      offeredPrice: counterOffer.offeredPrice,
      sentBy,
    },
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: successMessage,
    doc: counterOfferForResponse,
  });
});

const acceptCustomerCounterOffer = asyncHandler(async (req, res) => {
  const result = await acceptPendingOfferSafely({
    requestId: req.params.id,
    offerId: req.params.offerId,
    actorAccountId: req.accountId,
    acceptedBy: "driver",
  });

  return sendSuccess({
    res,
    message: "تم قبول السعر المضاد وتأكيد الطلب بنجاح",
    doc: result,
  });
});

const rejectOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);
  assertRequestNotLifecycleLocked(request);

  if (request.customerAccountId.toString() !== req.accountId) {
    const error = new Error("العميل صاحب الطلب فقط يمكنه رفض العرض");
    error.statusCode = 403;
    throw error;
  }

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: "pending",
  });

  if (!offer) {
    const error = new Error("العرض غير موجود أو لم يعد متاحًا");
    error.statusCode = 404;
    throw error;
  }

  assertOfferStillValid(offer);

  offer.status = "rejected";
  offer.rejectedAt = new Date();
  await offer.save();

  safeSocketEmit(() => {
    emitToAccount(offer.driverAccountId.toString(), "offer:rejected", {
      requestId: request._id,
      offer,
    });

    emitToRequest(request._id.toString(), "offer:rejected", {
      requestId: request._id,
      offer,
    });
  });

  await safeCreateNotification({
    accountId: offer.driverAccountId,
    title: "تم رفض العرض",
    body: "العميل رفض العرض المرسل منك",
    type: "offer",
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
    },
  });

  return sendSuccess({
    res,
    message: "تم رفض العرض بنجاح",
    doc: offer,
  });
});

const rejectCustomerCounterOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);
  assertRequestNotLifecycleLocked(request);

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: "pending",
    sentBy: "customer",
  });

  if (!offer) {
    const error = new Error("السعر المضاد غير موجود أو لم يعد متاحًا");
    error.statusCode = 404;
    throw error;
  }

  assertOfferStillValid(offer);

  if (offer.driverAccountId.toString() !== req.accountId) {
    const error = new Error("السائق صاحب العرض فقط يمكنه رفض السعر المضاد");
    error.statusCode = 403;
    throw error;
  }

  offer.status = "rejected";
  offer.rejectedAt = new Date();
  await offer.save();

  safeSocketEmit(() => {
    emitToAccount(
      request.customerAccountId.toString(),
      "offer:counter-rejected",
      {
        requestId: request._id,
        offer,
      },
    );

    emitToRequest(request._id.toString(), "offer:counter-rejected", {
      requestId: request._id,
      offer,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: "تم رفض السعر المضاد",
    body: "السائق رفض السعر المضاد الذي أرسلته",
    type: "offer",
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
    },
  });

  return sendSuccess({
    res,
    message: "تم رفض السعر المضاد بنجاح",
    doc: offer,
  });
});

const updateServiceRequestStatus = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  const {
    status,
    cancellationReason,
    actualDistanceKm,
    finalDistanceKm,
    completedDistanceKm,
    waitingMinutes,
    waitMinutes,
    manualAdjustment,
    extraFare,
    finalFareNote,
    deliveryProofType,
    deliveryProofUrl,
    deliveryProofNote,
    deliveryNote,
    proofNote,
    recipientName,
    receiverName,
    recipientPhone,
    receiverPhone,
    handoffOtp,
  } = req.body;

  const statusBeforeUpdate = request.status;

  const isCustomer = request.customerAccountId.toString() === req.accountId;
  const isAcceptedDriver =
    request.acceptedDriverAccountId?.toString() === req.accountId;

  const allowedStatuses = [
    "driver_arriving",
    "arrived_to_pickup",
    "in_progress",
    "completed",
    "cancelled_by_customer",
    "cancelled_by_driver",
    "driver_no_show",
    "customer_no_show",
  ];

  if (!allowedStatuses.includes(status)) {
    const error = new Error("حالة الطلب غير صحيحة");
    error.statusCode = 400;
    throw error;
  }

  assertStatusTransitionAllowed({
    currentStatus: request.status,
    nextStatus: status,
  });

  if (status === "cancelled_by_customer" && !isCustomer) {
    const error = new Error("العميل صاحب الطلب فقط يمكنه إلغاء الطلب");
    error.statusCode = 403;
    throw error;
  }

  if (
    [
      "driver_arriving",
      "arrived_to_pickup",
      "in_progress",
      "completed",
      "cancelled_by_driver",
    ].includes(status) &&
    !isAcceptedDriver
  ) {
    const error = new Error("السائق المقبول فقط يمكنه تحديث هذه الحالة");
    error.statusCode = 403;
    throw error;
  }

  let penaltyResult = null;

  if (status === "driver_arriving") {
    request.status = "driver_arriving";
    request.driverArrivingAt = request.driverArrivingAt || new Date();
  }

  if (status === "arrived_to_pickup") {
    request.status = "arrived_to_pickup";
    request.arrivedAt = request.arrivedAt || new Date();
  }

  if (status === "in_progress") {
    request.status = "in_progress";
    request.startedAt = request.startedAt || new Date();
  }

  if (status === "completed") {
    if (request.serviceType === "delivery_order") {
      const details = request.deliveryDetails || {};

      if (details.pickupStatus !== "picked_up") {
        const error = new Error("يجب تأكيد استلام الطلب من مكانه قبل التسليم");
        error.statusCode = 400;
        throw error;
      }

      const proofType = deliveryProofType || details.deliveryProofType || "none";
      const proofUrl = deliveryProofUrl || details.deliveryProofUrl || "";
      const normalizedDeliveryProofNote =
        deliveryProofNote || deliveryNote || proofNote || details.deliveryProofNote || "";
      const normalizedRecipientName =
        recipientName || receiverName || details.recipientName || "";

      if (
        proofType === "none" &&
        !proofUrl &&
        !normalizedDeliveryProofNote &&
        !normalizedRecipientName
      ) {
        const error = new Error("إثبات تسليم الطلب أو اسم المستلم مطلوب");
        error.statusCode = 400;
        throw error;
      }

      request.deliveryDetails.deliveryStatus = "delivered";
      request.deliveryDetails.deliveredAt = request.deliveryDetails.deliveredAt || new Date();
      request.deliveryDetails.deliveryProofType = proofType;
      request.deliveryDetails.deliveryProofUrl = proofUrl;
      request.deliveryDetails.deliveryProofNote = normalizedDeliveryProofNote;
      request.deliveryDetails.recipientName = normalizedRecipientName;
      request.deliveryDetails.recipientPhone =
        recipientPhone || receiverPhone || details.recipientPhone || "";
      request.deliveryDetails.handoffOtp = handoffOtp || details.handoffOtp || "";
    }

    request.status = "completed";
    request.completedAt = new Date();

    const vehicle = await Vehicle.findOne({
      code: request.vehicleTypeCode,
    });

    const commissionPercent = getCommissionPercent(
      vehicle,
      request.serviceType,
    );

    const finalFare = calculateFinalFareOnCompletion({
      request,
      vehicle,
      body: {
        actualDistanceKm,
        finalDistanceKm,
        completedDistanceKm,
        waitingMinutes,
        waitMinutes,
        manualAdjustment,
        extraFare,
        finalFareNote,
      },
    });

    request.finalPrice = finalFare.finalPrice;
    request.finalFareDetails = finalFare.details;
    request.customerPayablePrice = roundMoney(
      Math.max(request.finalPrice - Number(request.customerDiscountAmount || 0), 0),
    );

    const deliveryItemReimbursementAmount = getDeliveryItemReimbursementAmount(request);

    if (request.serviceType === "delivery_order") {
      request.deliveryDetails.itemCostReimbursementAmount =
        deliveryItemReimbursementAmount;
      request.deliveryDetails.customerTotalPayableToDriver = roundMoney(
        request.customerPayablePrice + deliveryItemReimbursementAmount,
      );
      request.deliveryDetails.commissionableDeliveryFare = request.finalPrice;
    }

    request.commissionPercent = commissionPercent;
    request.grossCommissionAmount = roundMoney(
      (request.finalPrice * commissionPercent) / 100,
    );

    let driverPromoApplication = {
      discountAmount: 0,
      netCommissionAmount: request.grossCommissionAmount,
    };

    if (request.acceptedOfferId) {
      const acceptedOffer = await ServiceOffer.findById(request.acceptedOfferId);
      driverPromoApplication = await applyDriverPromoToCommission({
        request,
        offer: acceptedOffer,
        grossCommissionAmount: request.grossCommissionAmount,
      });
    }

    request.driverPromoDiscountAmount = roundMoney(
      driverPromoApplication.discountAmount || 0,
    );
    request.commissionAmount = roundMoney(
      driverPromoApplication.netCommissionAmount,
    );
    request.driverNetAmount = roundMoney(
      Math.max(request.finalPrice - request.commissionAmount, 0),
    );
    request.appDriverPayableAmount = roundMoney(request.appCoveredDiscountAmount || 0);

    await applyCustomerPromoForRequest({ serviceRequestId: request._id });

    const financeResult = await recordCompletedRequestFinance({ request });

    if (financeResult.wallet) {
      request.driverWalletId = financeResult.wallet._id;
    }

    if (financeResult.commissionTransaction) {
      request.commissionTransactionId = financeResult.commissionTransaction._id;
    }

    request.financeSummary = {
      customerPaidToDriver:
        request.serviceType === "delivery_order"
          ? request.deliveryDetails.customerTotalPayableToDriver ||
            request.customerPayablePrice ||
            0
          : request.customerPayablePrice || 0,
      appCoveredDiscountAddedToDriverBalance: request.appCoveredDiscountAmount || 0,
      grossCommissionAmount: request.grossCommissionAmount || 0,
      driverPromoDiscountAmount: request.driverPromoDiscountAmount || 0,
      netCommissionDebtAdded: request.commissionAmount || 0,
      driverNetAfterCommission: request.driverNetAmount || 0,
      deliveryItemReimbursementAmount:
        request.serviceType === "delivery_order"
          ? request.deliveryDetails.itemCostReimbursementAmount || 0
          : 0,
      recordedAt: new Date(),
    };

    if (financeResult.driverProfile) {
      safeSocketEmit(() => {
        emitToAccount(
          request.acceptedDriverAccountId.toString(),
          "finance:debt-updated",
          {
            commissionDebt: financeResult.driverProfile.commissionDebt,
            commissionDebtLimit: financeResult.driverProfile.commissionDebtLimit,
            isBlockedForDebt: financeResult.driverProfile.isBlockedForDebt,
            wallet: financeResult.wallet,
          },
        );
      });
    }

    const loyaltyResult = !financeResult.wasAlreadyRecorded
      ? await awardLoyaltyForCompletedRequest({ request })
      : { customerTransaction: null, driverTransaction: null };

    request.loyaltySummary = {
      customerPointsEarned: loyaltyResult.customerTransaction?.points || 0,
      driverPointsEarned: loyaltyResult.driverTransaction?.points || 0,
    };

    if (request.acceptedDriverAccountId) {
      const shouldBlockDriver = !!financeResult.driverProfile?.isBlockedForDebt;

      await DriverProfile.findOneAndUpdate(
        {
          accountId: request.acceptedDriverAccountId,
          activeServiceRequestId: request._id,
        },
        {
          activeServiceRequestId: null,
          currentVehicleId: null,
          isAvailable: !shouldBlockDriver,
          ...(shouldBlockDriver ? { isOnline: false } : {}),
        },
        {
          new: true,
        },
      );
    }
  }

  if (status === "cancelled_by_customer") {
    request.status = "cancelled_by_customer";
    request.cancellationReason = cancellationReason || "";
    request.cancelledAt = new Date();

    penaltyResult = await applyCancellationPenalty({
      request,
      actorType: "customer",
      accountId: request.customerAccountId,
      reason: cancellationReason || "إلغاء الطلب من العميل",
      statusBeforeCancellation: statusBeforeUpdate,
      createdBy: req.roles?.includes("admin") ? "admin" : "system",
      adminId: req.roles?.includes("admin") ? req.accountId : null,
    });
  }

  if (status === "cancelled_by_driver") {
    request.status = "cancelled_by_driver";
    request.cancellationReason = cancellationReason || "";
    request.cancelledAt = new Date();

    penaltyResult = await applyCancellationPenalty({
      request,
      actorType: "driver",
      accountId: request.acceptedDriverAccountId || req.accountId,
      reason: cancellationReason || "إلغاء الطلب من السائق",
      statusBeforeCancellation: statusBeforeUpdate,
      createdBy: req.roles?.includes("admin") ? "admin" : "system",
      adminId: req.roles?.includes("admin") ? req.accountId : null,
    });
  }

  if (status === "driver_no_show") {
    if (!isCustomer && !req.roles?.includes("admin")) {
      const error = new Error(
        "العميل أو الإدارة فقط يمكنهم تسجيل عدم حضور السائق",
      );
      error.statusCode = 403;
      throw error;
    }

    request.status = "driver_no_show";
    request.cancellationReason = cancellationReason || "السائق لم يحضر";
    request.cancelledAt = new Date();

    if (request.acceptedDriverAccountId) {
      penaltyResult = await applyCancellationPenalty({
        request,
        actorType: "driver",
        accountId: request.acceptedDriverAccountId,
        reason: cancellationReason || "السائق لم يحضر",
        statusBeforeCancellation: statusBeforeUpdate,
        createdBy: req.roles?.includes("admin") ? "admin" : "system",
        adminId: req.roles?.includes("admin") ? req.accountId : null,
      });
    }
  }

  if (status === "customer_no_show") {
    if (!isAcceptedDriver && !req.roles?.includes("admin")) {
      const error = new Error(
        "السائق أو الإدارة فقط يمكنهم تسجيل عدم حضور العميل",
      );
      error.statusCode = 403;
      throw error;
    }

    request.status = "customer_no_show";
    request.cancellationReason = cancellationReason || "العميل لم يحضر";
    request.cancelledAt = new Date();

    penaltyResult = await applyCancellationPenalty({
      request,
      actorType: "customer",
      accountId: request.customerAccountId,
      reason: cancellationReason || "العميل لم يحضر",
      statusBeforeCancellation: statusBeforeUpdate,
      createdBy: req.roles?.includes("admin") ? "admin" : "system",
      adminId: req.roles?.includes("admin") ? req.accountId : null,
    });
  }

  if (
    [
      "cancelled_by_customer",
      "cancelled_by_driver",
      "driver_no_show",
      "customer_no_show",
    ].includes(status)
  ) {
    await cancelPromoReservationsForRequest({
      serviceRequestId: request._id,
    });
  }

  if (
    [
      "cancelled_by_customer",
      "cancelled_by_driver",
      "driver_no_show",
      "customer_no_show",
    ].includes(status) &&
    request.acceptedDriverAccountId
  ) {
    const driverPenaltyApplied =
      penaltyResult?.applied &&
      penaltyResult.penalty?.accountRole === "driver";

    await DriverProfile.findOneAndUpdate(
      {
        accountId: request.acceptedDriverAccountId,
        activeServiceRequestId: request._id,
      },
      {
        activeServiceRequestId: null,
        isAvailable: !driverPenaltyApplied,
        ...(driverPenaltyApplied ? { isOnline: false } : {}),
      },
      {
        new: true,
      },
    );
  }

  request.lastStatusChangedAt = new Date();

  await request.save();

  const requestIdString = request._id.toString();
  const penaltySocketPayload = penaltyResult?.applied
    ? {
        penaltyId: penaltyResult.penalty?._id,
        blockUntil: penaltyResult.penalty?.blockUntil,
        blockMinutes: penaltyResult.penalty?.blockMinutes,
        phase: penaltyResult.phase,
      }
    : null;

  const runtimeRequest = {
    ...request.toObject({ depopulate: true }),
    _id: request._id,
    id: requestIdString,
    requestId: requestIdString,
  };

  const emitStatusToParties = (eventName, payload) => {
    emitToRooms(
      [
        getRequestRoom(requestIdString),
        getAccountRoom(request.customerAccountId.toString()),
        request.acceptedDriverAccountId
          ? getAccountRoom(request.acceptedDriverAccountId.toString())
          : null,
      ],
      eventName,
      payload,
    );

    if (
      eventName === "request:status-changed" &&
      request.vehicleTypeCode &&
      ["pending_offers", "negotiating", "cancelled_by_customer", "expired"].includes(
        request.status,
      )
    ) {
      emitToVehicle(request.vehicleTypeCode, eventName, payload);
    }
  };

  // This compact event is the runtime tunnel. It is emitted as soon as the
  // authoritative database save succeeds and never waits for populate/rating
  // queries. Flutter merges only its status fields into the current request.
  const runtimePayload = {
    request: runtimeRequest,
    requestId: requestIdString,
    serviceRequestId: requestIdString,
    status: request.status,
    lastStatusChangedAt: request.lastStatusChangedAt,
    penalty: penaltySocketPayload,
    emittedAt: new Date(),
  };

  safeSocketEmit(() => {
    emitStatusToParties("request:status-live", runtimePayload);
    emitToAdmins("admin:request-status-live", runtimePayload);
  });

  const emitEnrichedStatus = (requestForParties) => {
    const payload = {
      request: requestForParties,
      status: request.status,
      penalty: penaltySocketPayload,
    };

    emitStatusToParties("request:status-changed", payload);
    emitToAdmins("admin:request-status-changed", payload);
  };

  const usesFastRuntimeResponse = [
    "driver_arriving",
    "arrived_to_pickup",
    "in_progress",
  ].includes(request.status);

  let requestForResponse = runtimeRequest;

  if (usesFastRuntimeResponse) {
    // Keep the HTTP action fast as well. The enriched compatibility event is
    // still emitted in the background for screens/admin code that need it.
    setImmediate(async () => {
      try {
        const requestForParties = await loadEnrichedRequestById({
          requestId: request._id,
          includeContactInfo: !!request.acceptedDriverAccountId,
        });

        safeSocketEmit(() => emitEnrichedStatus(requestForParties));
      } catch (error) {
        console.error("Async request status enrichment error:", error.message);
      }
    });
  } else {
    requestForResponse = await loadEnrichedRequestById({
      requestId: request._id,
      includeContactInfo: !!request.acceptedDriverAccountId,
    });

    safeSocketEmit(() => emitEnrichedStatus(requestForResponse));
  }

  const responsePayload = {
    res,
    message: "تم تحديث حالة الطلب بنجاح",
    doc: requestForResponse,
    extra: {
      penalty: penaltyResult?.applied
        ? {
            penaltyId: penaltyResult.penalty?._id,
            blockUntil: penaltyResult.penalty?.blockUntil,
            blockMinutes: penaltyResult.penalty?.blockMinutes,
            phase: penaltyResult.phase,
            restrictions: penaltyResult.restrictions || [],
          }
        : null,
    },
  };

  const statusNotifications = buildStatusNotifications(request);

  setImmediate(() => {
    if (statusNotifications?.customer) {
      safeCreateNotification({
        accountId: request.customerAccountId,
        title: statusNotifications.customer.title,
        body: statusNotifications.customer.body,
        type: "request",
        data: {
          serviceRequestId: request._id,
          status: request.status,
        },
      });
    }

    if (statusNotifications?.driver && request.acceptedDriverAccountId) {
      safeCreateNotification({
        accountId: request.acceptedDriverAccountId,
        title: statusNotifications.driver.title,
        body: statusNotifications.driver.body,
        type: "request",
        data: {
          serviceRequestId: request._id,
          status: request.status,
        },
      });
    }
  });

  return sendSuccess(responsePayload);
});


const confirmDeliveryPickup = asyncHandler(async (req, res, next) => {
  const request = await ensureRequestExists(req.params.id);

  assertDeliveryOrderRequest(request);
  assertAcceptedDriverForRequest({ request, accountId: req.accountId });

  if (request.status !== "arrived_to_pickup") {
    const error = new Error("يجب تسجيل الوصول إلى مكان الاستلام أولا");
    error.statusCode = 400;
    throw error;
  }

  if (request.deliveryDetails?.pickupStatus === "picked_up") {
    const error = new Error("تم تأكيد استلام الطلب بالفعل");
    error.statusCode = 400;
    throw error;
  }

  const {
    actualItemCost,
    actualValue,
    itemCostPaidByDriver,
    driverPaidForItems,
    driverPaysForItems,
    pickupProofType,
    pickupProofUrl,
    pickupProofNote,
    pickupNote,
    proofNote,
    paymentNotes,
  } = req.body;

  const normalizedActualItemCost = roundMoney(
    firstDefinedValue(
      actualItemCost,
      actualValue,
      request.deliveryDetails?.expectedItemCost,
      0,
    ),
  );

  assertDeliveryItemCostWithinLimit({
    request,
    actualItemCost: normalizedActualItemCost,
  });

  const responsibility = normalizeDeliveryPaymentResponsibility(
    request.deliveryDetails || {},
  );

  request.deliveryDetails.pickupStatus = "picked_up";
  request.deliveryDetails.pickupConfirmedAt = new Date();
  request.deliveryDetails.actualItemCost = normalizedActualItemCost;
  request.deliveryDetails.itemCostPaidByDriver =
    responsibility === "driver_pays_pickup"
      ? firstDefinedValue(
          itemCostPaidByDriver,
          driverPaidForItems,
          driverPaysForItems,
          true,
        ) !== false
      : firstDefinedValue(
          itemCostPaidByDriver,
          driverPaidForItems,
          driverPaysForItems,
          false,
        ) === true;
  request.deliveryDetails.itemCostConfirmedAt = new Date();
  request.deliveryDetails.pickupProofType = pickupProofType || "note";
  request.deliveryDetails.pickupProofUrl = pickupProofUrl || "";
  request.deliveryDetails.pickupProofNote =
    pickupProofNote || pickupNote || proofNote || "";
  request.deliveryDetails.paymentNotes =
    paymentNotes || request.deliveryDetails.paymentNotes || "";

  await request.save();

  req.body.status = "in_progress";

  return updateServiceRequestStatus(req, res, next);
});

const confirmDeliveryDelivered = asyncHandler(async (req, res, next) => {
  const request = await ensureRequestExists(req.params.id);

  assertDeliveryOrderRequest(request);
  assertAcceptedDriverForRequest({ request, accountId: req.accountId });

  if (request.status !== "in_progress") {
    const error = new Error("لا يمكن تسليم الطلب قبل تأكيد استلامه من مكانه");
    error.statusCode = 400;
    throw error;
  }

  if (request.deliveryDetails?.deliveryStatus === "delivered") {
    const error = new Error("تم تأكيد تسليم الطلب بالفعل");
    error.statusCode = 400;
    throw error;
  }

  req.body.status = "completed";

  return updateServiceRequestStatus(req, res, next);
});

module.exports = {
  createServiceRequest,
  getMyServiceRequests,
  getAvailableServiceRequestsForDriver,
  getServiceRequestById,
  getRequestOffers,
  getOfferNegotiations,
  createDriverOffer,
  createCustomerCounterOffer,
  acceptOffer,
  rejectOffer,
  acceptCustomerCounterOffer,
  rejectCustomerCounterOffer,
  updateServiceRequestStatus,
  confirmDeliveryPickup,
  confirmDeliveryDelivered,
};