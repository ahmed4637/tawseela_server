const mongoose = require('mongoose');

const ServiceRequest = require('../models/serviceRequest.model');
const ServiceOffer = require('../models/serviceOffer.model');
const Rating = require('../models/rating.model');
const Vehicle = require('../models/vehicle.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const CommissionTransaction = require('../models/commissionTransaction.model');
const { getSearchRadiusKmByServiceType } = require('../services/appSettings.service');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { createNotification } = require('../services/notification.service');
const {
  getIO,
  emitToAccount,
  emitToRequest,
} = require('../sockets/socket.server');

const isDevelopment = process.env.NODE_ENV === 'development';

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const generateRequestCode = () => {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `TS-${Date.now()}-${random}`;
};

const roundMoney = (value) => {
  return Math.round((Number(value) || 0) * 100) / 100;
};


const buildGeoPoint = ({ lat, lng }) => {
  return {
    type: 'Point',
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

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = 'approved';
  }

  const driverVehicles = await DriverVehicle.find(vehicleQuery).select('accountId');

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
      $lt: ['$commissionDebt', '$commissionDebtLimit'],
    },
    currentLocation: {
      $near: {
        $geometry: request.pickupLocation,
        $maxDistance: maxDistanceMeters,
      },
    },
  }).select('accountId');

  return profiles.map((profile) => profile.accountId.toString());
};

const safeSocketEmit = (callback) => {
  try {
    callback();
  } catch (error) {
    console.error('Socket emit error:', error.message);
  }
};
const safeCreateNotification = async ({
  accountId,
  title,
  body,
  type = 'general',
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
    console.error('Create notification error:', error.message);
  }
};

const buildStatusNotifications = (request) => {
  const finalPrice = request.finalPrice || 0;
  const commissionAmount = request.commissionAmount || 0;

  const map = {
    driver_arriving: {
      customer: {
        title: 'السائق في الطريق',
        body: 'السائق بدأ التحرك إلى نقطة الانطلاق',
      },
      driver: {
        title: 'تم تحديث حالة الطلب',
        body: 'أنت الآن في الطريق إلى العميل',
      },
    },

    arrived_to_pickup: {
      customer: {
        title: 'السائق وصل',
        body: 'السائق وصل إلى نقطة الانطلاق',
      },
      driver: {
        title: 'تم تسجيل الوصول',
        body: 'تم تسجيل وصولك إلى العميل',
      },
    },

    in_progress: {
      customer: {
        title: 'بدأت الرحلة',
        body: 'تم بدء الرحلة بنجاح',
      },
      driver: {
        title: 'بدأت الرحلة',
        body: 'تم بدء الرحلة بنجاح',
      },
    },

    completed: {
      customer: {
        title: 'تم إنهاء الطلب',
        body: `تم إنهاء الطلب بنجاح. السعر النهائي ${finalPrice} جنيه`,
      },
      driver: {
        title: 'تم إنهاء الطلب',
        body: `تم إنهاء الطلب. عمولة التطبيق المستحقة ${commissionAmount} جنيه`,
      },
    },

    cancelled_by_customer: {
      customer: {
        title: 'تم إلغاء الطلب',
        body: 'تم إلغاء الطلب من طرف العميل',
      },
      driver: {
        title: 'تم إلغاء الطلب',
        body: 'العميل قام بإلغاء الطلب',
      },
    },

    cancelled_by_driver: {
      customer: {
        title: 'تم إلغاء الطلب',
        body: 'السائق قام بإلغاء الطلب',
      },
      driver: {
        title: 'تم إلغاء الطلب',
        body: 'تم إلغاء الطلب من طرفك',
      },
    },

    driver_no_show: {
      customer: {
        title: 'تم تسجيل عدم حضور السائق',
        body: 'تم تسجيل أن السائق لم يحضر للرحلة',
      },
      driver: {
        title: 'تم تسجيل عدم حضور',
        body: 'تم تسجيل عدم حضورك للرحلة',
      },
    },

    customer_no_show: {
      customer: {
        title: 'تم تسجيل عدم حضور العميل',
        body: 'تم تسجيل عدم حضورك للرحلة',
      },
      driver: {
        title: 'تم تسجيل عدم حضور العميل',
        body: 'تم تسجيل أن العميل لم يحضر للرحلة',
      },
    },
  };

  return map[request.status] || null;
};

const getCommissionPercent = (vehicle, serviceType) => {
  if (!vehicle?.commission) {
    return 0;
  }

  if (serviceType === 'instant_ride') {
    return vehicle.commission.instantRidePercent || 0;
  }

  if (serviceType === 'scheduled_ride') {
    return vehicle.commission.scheduledRidePercent || 0;
  }

  if (serviceType === 'delivery_order') {
    return vehicle.commission.deliveryOrderPercent || 0;
  }

  return 0;
};

const calculateEstimatedPrice = ({ vehicle, distanceKm }) => {
  const distance = Number(distanceKm) || 0;

  const rawPrice =
    Number(vehicle.startPrice || 0) + distance * Number(vehicle.pricePerKm || 0);

  return roundMoney(Math.max(rawPrice, Number(vehicle.minPrice || 0)));
};

const ensureRequestExists = async (requestId) => {
  if (!isValidObjectId(requestId)) {
    const error = new Error('رقم الطلب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const request = await ServiceRequest.findById(requestId);

  if (!request) {
    const error = new Error('الطلب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  return request;
};

const ensureDriverCanWork = async (accountId) => {
  const driverProfile = await DriverProfile.findOne({ accountId });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 403;
    throw error;
  }

  driverProfile.refreshDebtBlockStatus();
  await driverProfile.save();

  if (!isDevelopment) {
    if (!driverProfile.isApproved || driverProfile.reviewStatus !== 'approved') {
      const error = new Error('حساب السائق لم تتم الموافقة عليه بعد');
      error.statusCode = 403;
      throw error;
    }

    if (!driverProfile.isOnline) {
      const error = new Error('يجب أن يكون السائق Online لاستقبال الطلبات');
      error.statusCode = 403;
      throw error;
    }
  }

  if (driverProfile.isBlockedForDebt) {
    const error = new Error(
      driverProfile.blockedReason ||
        'تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق'
    );
    error.statusCode = 403;
    throw error;
  }

  if (driverProfile.commissionDebt >= driverProfile.commissionDebtLimit) {
    const error = new Error('يجب سداد مستحقات التطبيق قبل استقبال طلبات جديدة');
    error.statusCode = 403;
    throw error;
  }

  if (driverProfile.activeServiceRequestId) {
    const error = new Error('لا يمكن للسائق العمل على أكثر من طلب في نفس الوقت');
    error.statusCode = 403;
    throw error;
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
    scheduledAt,
    deliveryDetails,
  } = req.body;

  const vehicle = await Vehicle.findOne({
    code: vehicleTypeCode.toString().trim().toLowerCase(),
    isActive: true,
  });

  if (!vehicle) {
    const error = new Error('نوع المركبة غير موجود أو غير مفعل');
    error.statusCode = 404;
    throw error;
  }

  if (!vehicle.allowedServices.includes(serviceType)) {
    const error = new Error('نوع المركبة لا يدعم هذا النوع من الطلبات');
    error.statusCode = 400;
    throw error;
  }

  if (serviceType === 'scheduled_ride') {
    if (!scheduledAt) {
      const error = new Error('وقت الحجز مطلوب');
      error.statusCode = 400;
      throw error;
    }

    const scheduledDate = new Date(scheduledAt);

    if (Number.isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      const error = new Error('وقت الحجز يجب أن يكون في المستقبل');
      error.statusCode = 400;
      throw error;
    }
  }

  if (serviceType === 'delivery_order') {
    if (!deliveryDetails?.itemDescription) {
      const error = new Error('وصف الطلب مطلوب');
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
    const error = new Error('السعر المعروض من العميل غير صحيح');
    error.statusCode = 400;
    throw error;
  }

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

    scheduledAt: serviceType === 'scheduled_ride' ? scheduledAt : null,

    deliveryDetails:
      serviceType === 'delivery_order'
        ? {
            itemDescription: deliveryDetails.itemDescription,
            driverWillPayForItems:
              deliveryDetails.driverWillPayForItems === true,
            expectedItemCost: Number(deliveryDetails.expectedItemCost) || 0,
            paymentNotes: deliveryDetails.paymentNotes || '',
          }
        : undefined,

    status: 'pending_offers',
  });

  const nearbyDriverAccountIds = await findNearbyDriverAccountIdsForRequest(doc);

  safeSocketEmit(() => {
    emitToAccount(req.accountId, 'request:created', {
      request: doc,
    });

    nearbyDriverAccountIds.forEach((driverAccountId) => {
      emitToAccount(driverAccountId, 'request:new', {
        request: doc,
      });
    });

    getIO().to('admins').emit('admin:request-created', {
      request: doc,
      nearbyDriversCount: nearbyDriverAccountIds.length,
    });
  });

  await safeCreateNotification({
  accountId: req.accountId,
  title: 'تم إنشاء الطلب',
  body: 'تم إنشاء طلبك بنجاح وفي انتظار عروض السائقين',
  type: 'request',
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
    message: 'تم إنشاء الطلب بنجاح وفي انتظار عروض السائقين',
    doc,
  });
});

const getMyServiceRequests = asyncHandler(async (req, res) => {
  const { as } = req.query;

  const query =
    as === 'driver'
      ? { acceptedDriverAccountId: req.accountId }
      : { customerAccountId: req.accountId };

  const baseDocs = await ServiceRequest.find(query)
    .sort({ createdAt: -1 })
    .select('_id status acceptedDriverAccountId customerAccountId');

  const docs = [];

  for (const item of baseDocs) {
    const includeContactInfo =
      confirmedStatuses.includes(item.status) &&
      !!item.acceptedDriverAccountId;

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
    message: 'تم جلب الطلبات بنجاح',
    docs,
  });
});

const getAvailableServiceRequestsForDriver = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا المسار متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await ensureDriverCanWork(req.accountId);

  if (
    driverProfile.currentLat === null ||
    driverProfile.currentLng === null ||
    !driverProfile.currentLocation?.coordinates?.length
  ) {
    return sendSuccess({
      res,
      message: 'لا توجد طلبات متاحة لأن موقع السائق غير محدد',
      docs: [],
    });
  }

  const vehicleQuery = {
    accountId: req.accountId,
    isActive: true,
  };

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = 'approved';
  }

  const driverVehicles = await DriverVehicle.find(vehicleQuery);

  const vehicleCodes = driverVehicles
    .map((vehicle) => vehicle.vehicleTypeCode)
    .filter(Boolean);

  if (vehicleCodes.length === 0) {
    return sendSuccess({
      res,
      message: 'لا توجد مركبات متاحة لهذا السائق',
      docs: [],
    });
  }

  const { serviceType } = req.query;

  const query = {
    customerAccountId: { $ne: req.accountId },
    status: { $in: ['pending_offers', 'negotiating'] },
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
      return request.distanceFromDriverKm <= Number(request.searchRadiusKm || 5);
    })
    .sort((a, b) => a.distanceFromDriverKm - b.distanceFromDriverKm);

  return sendSuccess({
    res,
    message: 'تم جلب الطلبات القريبة المتاحة للسائق بنجاح',
    docs,
  });
});
const accountPublicFields = 'name profileImage image photo avatar';
const accountContactFields = 'name phone profileImage image photo avatar';

const driverVehiclePublicFields =
  'vehicleTypeCode vehicleTypeName plateNumber vehicleNumber vehicleImage image photo vehiclePhoto carImage brand model color';

const confirmedStatuses = [
  'offer_accepted',
  'driver_arriving',
  'arrived_to_pickup',
  'in_progress',
  'completed',
];

const toPlainObject = (doc) => {
  if (!doc) return null;

  return doc.toObject && typeof doc.toObject === 'function'
    ? doc.toObject()
    : { ...doc };
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
        _id: '$toAccountId',
        ratingAverage: { $avg: '$stars' },
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
    ...raw,
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
    ...raw,
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

  if (offer.driverAccountId && typeof offer.driverAccountId === 'object') {
    offer.driverAccountId = await enrichDriverAccountObject(
      offer.driverAccountId
    );
  }

  return offer;
};

const loadEnrichedOfferById = async (offerId) => {
  const offer = await ServiceOffer.findById(offerId)
    .populate('driverAccountId', accountPublicFields)
    .populate('driverVehicleId', driverVehiclePublicFields);

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
    .populate('customerAccountId', accountFields)
    .populate('acceptedDriverAccountId', accountFields)
    .populate('acceptedDriverVehicleId', driverVehiclePublicFields)
    .populate('vehicleTypeId');

  if (!requestDoc) return null;

  const request = requestDoc.toObject();

  if (
    request.customerAccountId &&
    typeof request.customerAccountId === 'object'
  ) {
    request.customerAccountId = await enrichAccountObject(
      request.customerAccountId
    );
  }

  if (
    request.acceptedDriverAccountId &&
    typeof request.acceptedDriverAccountId === 'object'
  ) {
    request.acceptedDriverAccountId = await enrichDriverAccountObject(
      request.acceptedDriverAccountId
    );
  }

  return request;
};

const canDriverViewOpenRequest = async ({ accountId, request }) => {
  const driverProfile = await ensureDriverCanWork(accountId);

  const vehicleQuery = {
    accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = 'approved';
  }

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
  const isDriver = req.roles?.includes('driver');
  const isAdmin = req.roles?.includes('admin');

  const isOpenForDrivers =
    baseRequest.status === 'pending_offers' ||
    baseRequest.status === 'negotiating';

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
    const error = new Error('غير مسموح لك بعرض هذا الطلب');
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
    .populate('driverAccountId', accountPublicFields)
    .populate('driverVehicleId', driverVehiclePublicFields)
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
        offer.status === 'accepted'
      );
    }) || null;

  return sendSuccess({
    res,
    message: 'تم جلب تفاصيل الطلب بنجاح',
    doc: {
      request,
      offers,
      acceptedOffer,
    },
  });
});

const createDriverOffer = asyncHandler(async (req, res) => {
  if (!req.roles?.includes('driver')) {
    const error = new Error('هذا الإجراء متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const request = await ensureRequestExists(req.params.id);

  if (!['pending_offers', 'negotiating'].includes(request.status)) {
    const error = new Error('لا يمكن إرسال عرض على هذا الطلب حاليًا');
    error.statusCode = 400;
    throw error;
  }

  if (request.customerAccountId.toString() === req.accountId) {
    const error = new Error('لا يمكن للسائق إرسال عرض على طلبه الشخصي');
    error.statusCode = 400;
    throw error;
  }

  await ensureDriverCanWork(req.accountId);

  const { driverVehicleId, offeredPrice, message } = req.body;

  const vehicleQuery = {
    _id: driverVehicleId,
    accountId: req.accountId,
    isActive: true,
    vehicleTypeCode: request.vehicleTypeCode,
  };

  if (!isDevelopment) {
    vehicleQuery.isApproved = true;
    vehicleQuery.reviewStatus = 'approved';
  }

  const driverVehicle = await DriverVehicle.findOne(vehicleQuery);

  if (!driverVehicle) {
    const error = new Error('مركبة السائق غير صالحة لهذا الطلب');
    error.statusCode = 400;
    throw error;
  }

  const price = Number(offeredPrice);

  if (price <= 0) {
    const error = new Error('السعر المعروض غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  let offer = await ServiceOffer.findOne({
    serviceRequestId: request._id,
    driverAccountId: req.accountId,
    status: 'pending',
    sentBy: 'driver',
  });

  if (offer) {
    offer.driverVehicleId = driverVehicle._id;
    offer.offeredPrice = roundMoney(price);
    offer.message = message || '';
    await offer.save();
  } else {
    offer = await ServiceOffer.create({
      serviceRequestId: request._id,
      driverAccountId: req.accountId,
      driverVehicleId: driverVehicle._id,
      offeredPrice: roundMoney(price),
      message: message || '',
      status: 'pending',
      sentBy: 'driver',
    });
  }

  request.status = 'negotiating';
  await request.save();

  const enrichedOffer = await loadEnrichedOfferById(offer._id);
  const offerForResponse = enrichedOffer || offer;

  safeSocketEmit(() => {
    emitToAccount(request.customerAccountId.toString(), 'offer:new', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });

    emitToRequest(request._id.toString(), 'offer:new', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });

    getIO().to('admins').emit('admin:offer-created', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: offerForResponse,
      request,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: 'عرض جديد على طلبك',
    body: `وصلك عرض جديد بسعر ${offer.offeredPrice} جنيه`,
    type: 'offer',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      offeredPrice: offer.offeredPrice,
    },
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال العرض للعميل بنجاح',
    doc: offerForResponse,
  });
});

const acceptOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  if (request.customerAccountId.toString() !== req.accountId) {
    const error = new Error('العميل صاحب الطلب فقط يمكنه قبول العرض');
    error.statusCode = 403;
    throw error;
  }

  if (!['pending_offers', 'negotiating'].includes(request.status)) {
    const error = new Error('لا يمكن قبول عرض على هذا الطلب حاليًا');
    error.statusCode = 400;
    throw error;
  }

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: 'pending',
  });

  if (!offer) {
    const error = new Error('العرض غير موجود أو لم يعد متاحًا');
    error.statusCode = 404;
    throw error;
  }

  if (offer.sentBy !== 'driver') {
    const error = new Error(
      'لا يمكن للعميل قبول عرض مرسل منه، يجب انتظار موافقة السائق'
    );
    error.statusCode = 400;
    throw error;
  }

  const driverProfile = await ensureDriverCanWork(
    offer.driverAccountId.toString()
  );

  const vehicle = await Vehicle.findOne({
    code: request.vehicleTypeCode,
  });

  const commissionPercent = getCommissionPercent(vehicle, request.serviceType);
  const finalPrice = roundMoney(offer.offeredPrice);
  const commissionAmount = roundMoney((finalPrice * commissionPercent) / 100);

  const lockedDriverProfile = await DriverProfile.findOneAndUpdate(
    {
      _id: driverProfile._id,
      activeServiceRequestId: null,
      isBlockedForDebt: false,
    },
    {
      activeServiceRequestId: request._id,
      currentVehicleId: offer.driverVehicleId,
      isAvailable: false,
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!lockedDriverProfile) {
    const error = new Error('السائق لم يعد متاحًا لهذا الطلب');
    error.statusCode = 400;
    throw error;
  }

  offer.status = 'accepted';
  offer.acceptedAt = new Date();
  await offer.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: request._id,
      _id: { $ne: offer._id },
      status: 'pending',
    },
    {
      status: 'rejected',
      rejectedAt: new Date(),
    }
  );

  request.status = 'offer_accepted';
  request.acceptedDriverAccountId = offer.driverAccountId;
  request.acceptedDriverVehicleId = offer.driverVehicleId;
  request.acceptedOfferId = offer._id;
  request.finalPrice = finalPrice;
  request.commissionPercent = commissionPercent;
  request.commissionAmount = commissionAmount;

  await request.save();

  const acceptedRequestForParties = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: true,
  });

  const acceptedRequestPublic = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: false,
  });

  const acceptedOfferForResponse =
    (await loadEnrichedOfferById(offer._id)) || offer;

  safeSocketEmit(() => {
    emitToAccount(offer.driverAccountId.toString(), 'offer:accepted', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });

    emitToAccount(request.customerAccountId.toString(), 'request:confirmed', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });

    emitToRequest(request._id.toString(), 'request:confirmed', {
      request: acceptedRequestPublic,
      offer: acceptedOfferForResponse,
    });

    getIO().to('admins').emit('admin:request-confirmed', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: 'تم تأكيد الطلب',
    body: `تم قبول العرض وتأكيد الطلب بسعر ${request.finalPrice} جنيه`,
    type: 'request',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      finalPrice: request.finalPrice,
    },
  });

  await safeCreateNotification({
    accountId: offer.driverAccountId,
    title: 'تم قبول عرضك',
    body: `العميل قبل عرضك بسعر ${request.finalPrice} جنيه`,
    type: 'offer',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      finalPrice: request.finalPrice,
    },
  });

  return sendSuccess({
    res,
    message: 'تم قبول العرض وتأكيد الطلب بنجاح',
    doc: {
      request: acceptedRequestForParties,
      acceptedOffer: acceptedOfferForResponse,
    },
  });
});

const createCustomerCounterOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  if (request.customerAccountId.toString() !== req.accountId) {
    const error = new Error('العميل صاحب الطلب فقط يمكنه إرسال سعر مضاد');
    error.statusCode = 403;
    throw error;
  }

  if (!['pending_offers', 'negotiating'].includes(request.status)) {
    const error = new Error('لا يمكن إرسال سعر مضاد على هذا الطلب حاليًا');
    error.statusCode = 400;
    throw error;
  }

  const { offerId } = req.params;
  const { offeredPrice, message } = req.body;

  const parentOffer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: 'pending',
  });

  if (!parentOffer) {
    const error = new Error('العرض الأصلي غير موجود أو لم يعد متاحًا');
    error.statusCode = 404;
    throw error;
  }

  if (parentOffer.sentBy !== 'driver') {
    const error = new Error('يمكن إرسال سعر مضاد فقط على عرض مرسل من السائق');
    error.statusCode = 400;
    throw error;
  }

  const price = Number(offeredPrice);

  if (price <= 0) {
    const error = new Error('السعر المضاد غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  parentOffer.status = 'cancelled';
  await parentOffer.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: request._id,
      driverAccountId: parentOffer.driverAccountId,
      status: 'pending',
      sentBy: 'customer',
    },
    {
      status: 'cancelled',
    }
  );

  const counterOffer = await ServiceOffer.create({
    serviceRequestId: request._id,
    driverAccountId: parentOffer.driverAccountId,
    driverVehicleId: parentOffer.driverVehicleId,
    offeredPrice: roundMoney(price),
    message: message || '',
    status: 'pending',
    sentBy: 'customer',
    parentOfferId: parentOffer._id,
  });

  request.status = 'negotiating';
  await request.save();

  const enrichedCounterOffer = await loadEnrichedOfferById(counterOffer._id);
  const counterOfferForResponse = enrichedCounterOffer || counterOffer;

  safeSocketEmit(() => {
    emitToAccount(parentOffer.driverAccountId.toString(), 'offer:countered', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });

    emitToRequest(request._id.toString(), 'offer:countered', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });

    getIO().to('admins').emit('admin:offer-countered', {
      requestId: request._id,
      serviceRequestId: request._id,
      offer: counterOfferForResponse,
      request,
    });
  });

  await safeCreateNotification({
    accountId: parentOffer.driverAccountId,
    title: 'سعر مضاد من العميل',
    body: `العميل عرض سعر ${counterOffer.offeredPrice} جنيه`,
    type: 'offer',
    data: {
      serviceRequestId: request._id,
      offerId: counterOffer._id,
      offeredPrice: counterOffer.offeredPrice,
    },
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال السعر المضاد للسائق بنجاح',
    doc: counterOfferForResponse,
  });
});

const acceptCustomerCounterOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  if (!['pending_offers', 'negotiating'].includes(request.status)) {
    const error = new Error('لا يمكن قبول هذا السعر حاليًا');
    error.statusCode = 400;
    throw error;
  }

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: 'pending',
    sentBy: 'customer',
  });

  if (!offer) {
    const error = new Error('السعر المضاد غير موجود أو لم يعد متاحًا');
    error.statusCode = 404;
    throw error;
  }

  if (offer.driverAccountId.toString() !== req.accountId) {
    const error = new Error('السائق صاحب العرض فقط يمكنه قبول السعر المضاد');
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await ensureDriverCanWork(req.accountId);

  const vehicle = await Vehicle.findOne({
    code: request.vehicleTypeCode,
  });

  const commissionPercent = getCommissionPercent(vehicle, request.serviceType);
  const finalPrice = roundMoney(offer.offeredPrice);
  const commissionAmount = roundMoney((finalPrice * commissionPercent) / 100);

  const lockedDriverProfile = await DriverProfile.findOneAndUpdate(
    {
      _id: driverProfile._id,
      activeServiceRequestId: null,
      isBlockedForDebt: false,
    },
    {
      activeServiceRequestId: request._id,
      currentVehicleId: offer.driverVehicleId,
      isAvailable: false,
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!lockedDriverProfile) {
    const error = new Error('السائق لم يعد متاحًا لهذا الطلب');
    error.statusCode = 400;
    throw error;
  }

  offer.status = 'accepted';
  offer.acceptedAt = new Date();
  await offer.save();

  await ServiceOffer.updateMany(
    {
      serviceRequestId: request._id,
      _id: { $ne: offer._id },
      status: 'pending',
    },
    {
      status: 'rejected',
      rejectedAt: new Date(),
    }
  );

  request.status = 'offer_accepted';
  request.acceptedDriverAccountId = offer.driverAccountId;
  request.acceptedDriverVehicleId = offer.driverVehicleId;
  request.acceptedOfferId = offer._id;
  request.finalPrice = finalPrice;
  request.commissionPercent = commissionPercent;
  request.commissionAmount = commissionAmount;

  await request.save();

  const acceptedRequestForParties = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: true,
  });

  const acceptedRequestPublic = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: false,
  });

  const acceptedOfferForResponse =
    (await loadEnrichedOfferById(offer._id)) || offer;

  safeSocketEmit(() => {
    emitToAccount(request.customerAccountId.toString(), 'offer:accepted-by-driver', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });

    emitToAccount(offer.driverAccountId.toString(), 'request:confirmed', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });

    emitToRequest(request._id.toString(), 'request:confirmed', {
      request: acceptedRequestPublic,
      offer: acceptedOfferForResponse,
    });

    getIO().to('admins').emit('admin:request-confirmed', {
      request: acceptedRequestForParties,
      offer: acceptedOfferForResponse,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: 'السائق وافق على السعر',
    body: `السائق وافق على السعر ${request.finalPrice} جنيه وتم تأكيد الطلب`,
    type: 'request',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      finalPrice: request.finalPrice,
    },
  });

  await safeCreateNotification({
    accountId: offer.driverAccountId,
    title: 'تم تأكيد الطلب',
    body: `تم تأكيد الطلب بسعر ${request.finalPrice} جنيه`,
    type: 'request',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
      finalPrice: request.finalPrice,
    },
  });

  return sendSuccess({
    res,
    message: 'تم قبول السعر المضاد وتأكيد الطلب بنجاح',
    doc: {
      request: acceptedRequestForParties,
      acceptedOffer: acceptedOfferForResponse,
    },
  });
});

const rejectOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  if (request.customerAccountId.toString() !== req.accountId) {
    const error = new Error('العميل صاحب الطلب فقط يمكنه رفض العرض');
    error.statusCode = 403;
    throw error;
  }

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: 'pending',
  });

  if (!offer) {
    const error = new Error('العرض غير موجود أو لم يعد متاحًا');
    error.statusCode = 404;
    throw error;
  }

  offer.status = 'rejected';
  offer.rejectedAt = new Date();
  await offer.save();

  safeSocketEmit(() => {
    emitToAccount(offer.driverAccountId.toString(), 'offer:rejected', {
      requestId: request._id,
      offer,
    });

    emitToRequest(request._id.toString(), 'offer:rejected', {
      requestId: request._id,
      offer,
    });
  });

  await safeCreateNotification({
  accountId: offer.driverAccountId,
  title: 'تم رفض العرض',
  body: 'العميل رفض العرض المرسل منك',
  type: 'offer',
  data: {
    serviceRequestId: request._id,
    offerId: offer._id,
  },
});

  return sendSuccess({
    res,
    message: 'تم رفض العرض بنجاح',
    doc: offer,
  });
});


const rejectCustomerCounterOffer = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  const { offerId } = req.params;

  const offer = await ServiceOffer.findOne({
    _id: offerId,
    serviceRequestId: request._id,
    status: 'pending',
    sentBy: 'customer',
  });

  if (!offer) {
    const error = new Error('السعر المضاد غير موجود أو لم يعد متاحًا');
    error.statusCode = 404;
    throw error;
  }

  if (offer.driverAccountId.toString() !== req.accountId) {
    const error = new Error('السائق صاحب العرض فقط يمكنه رفض السعر المضاد');
    error.statusCode = 403;
    throw error;
  }

  offer.status = 'rejected';
  offer.rejectedAt = new Date();
  await offer.save();

  safeSocketEmit(() => {
    emitToAccount(request.customerAccountId.toString(), 'offer:counter-rejected', {
      requestId: request._id,
      offer,
    });

    emitToRequest(request._id.toString(), 'offer:counter-rejected', {
      requestId: request._id,
      offer,
    });
  });

  await safeCreateNotification({
    accountId: request.customerAccountId,
    title: 'تم رفض السعر المضاد',
    body: 'السائق رفض السعر المضاد الذي أرسلته',
    type: 'offer',
    data: {
      serviceRequestId: request._id,
      offerId: offer._id,
    },
  });

  return sendSuccess({
    res,
    message: 'تم رفض السعر المضاد بنجاح',
    doc: offer,
  });
});

const updateServiceRequestStatus = asyncHandler(async (req, res) => {
  const request = await ensureRequestExists(req.params.id);

  const { status, cancellationReason } = req.body;

  const isCustomer = request.customerAccountId.toString() === req.accountId;
  const isAcceptedDriver =
    request.acceptedDriverAccountId?.toString() === req.accountId;

  const allowedStatuses = [
    'driver_arriving',
    'arrived_to_pickup',
    'in_progress',
    'completed',
    'cancelled_by_customer',
    'cancelled_by_driver',
    'driver_no_show',
    'customer_no_show',
  ];

  const terminalStatuses = [
    'completed',
    'cancelled_by_customer',
    'cancelled_by_driver',
    'driver_no_show',
    'customer_no_show',
  ];

  if (!allowedStatuses.includes(status)) {
    const error = new Error('حالة الطلب غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  if (terminalStatuses.includes(request.status)) {
    const error = new Error('لا يمكن تحديث طلب منتهي أو ملغي');
    error.statusCode = 400;
    throw error;
  }

  if (status === 'cancelled_by_customer' && !isCustomer) {
    const error = new Error('العميل صاحب الطلب فقط يمكنه إلغاء الطلب');
    error.statusCode = 403;
    throw error;
  }

  if (
    [
      'driver_arriving',
      'arrived_to_pickup',
      'in_progress',
      'completed',
      'cancelled_by_driver',
    ].includes(status) &&
    !isAcceptedDriver
  ) {
    const error = new Error('السائق المقبول فقط يمكنه تحديث هذه الحالة');
    error.statusCode = 403;
    throw error;
  }

  if (status === 'driver_arriving') {
    request.status = 'driver_arriving';
  }

  if (status === 'arrived_to_pickup') {
    request.status = 'arrived_to_pickup';
  }

  if (status === 'in_progress') {
    request.status = 'in_progress';
    request.startedAt = request.startedAt || new Date();
  }

  if (status === 'completed') {
    request.status = 'completed';
    request.completedAt = new Date();

    const existingCommission = await CommissionTransaction.findOne({
      serviceRequestId: request._id,
      type: 'commission',
    });

    if (!existingCommission && request.commissionAmount > 0) {
      await CommissionTransaction.create({
        driverAccountId: request.acceptedDriverAccountId,
        serviceRequestId: request._id,
        serviceType: request.serviceType,
        vehicleTypeCode: request.vehicleTypeCode,
        finalPrice: request.finalPrice,
        commissionPercent: request.commissionPercent,
        amount: request.commissionAmount,
        status: 'unpaid',
        notes: 'عمولة مستحقة بعد إتمام الطلب',
      });
    }

    const driverProfile = await DriverProfile.findOne({
      accountId: request.acceptedDriverAccountId,
    });

    if (driverProfile) {
      if (!existingCommission && request.commissionAmount > 0) {
        driverProfile.commissionDebt = roundMoney(
          driverProfile.commissionDebt + request.commissionAmount
        );
      }

      driverProfile.totalCompletedTrips += 1;
      driverProfile.activeServiceRequestId = null;
      driverProfile.isAvailable = true;
      driverProfile.refreshDebtBlockStatus();

      await driverProfile.save();

      safeSocketEmit(() => {
        emitToAccount(
          request.acceptedDriverAccountId.toString(),
          'finance:debt-updated',
          {
            commissionDebt: driverProfile.commissionDebt,
            commissionDebtLimit: driverProfile.commissionDebtLimit,
            isBlockedForDebt: driverProfile.isBlockedForDebt,
          }
        );
      });
    }
  }

  if (status === 'cancelled_by_customer') {
    request.status = 'cancelled_by_customer';
    request.cancellationReason = cancellationReason || '';
    request.cancelledAt = new Date();
  }

  if (status === 'cancelled_by_driver') {
    request.status = 'cancelled_by_driver';
    request.cancellationReason = cancellationReason || '';
    request.cancelledAt = new Date();
  }

  if (status === 'driver_no_show') {
    if (!isCustomer && !req.roles?.includes('admin')) {
      const error = new Error('العميل أو الإدارة فقط يمكنهم تسجيل عدم حضور السائق');
      error.statusCode = 403;
      throw error;
    }

    request.status = 'driver_no_show';
    request.cancellationReason = cancellationReason || 'السائق لم يحضر';
    request.cancelledAt = new Date();
  }

  if (status === 'customer_no_show') {
    if (!isAcceptedDriver && !req.roles?.includes('admin')) {
      const error = new Error('السائق أو الإدارة فقط يمكنهم تسجيل عدم حضور العميل');
      error.statusCode = 403;
      throw error;
    }

    request.status = 'customer_no_show';
    request.cancellationReason = cancellationReason || 'العميل لم يحضر';
    request.cancelledAt = new Date();
  }

  if (
    [
      'cancelled_by_customer',
      'cancelled_by_driver',
      'driver_no_show',
      'customer_no_show',
    ].includes(status) &&
    request.acceptedDriverAccountId
  ) {
    await DriverProfile.findOneAndUpdate(
      {
        accountId: request.acceptedDriverAccountId,
        activeServiceRequestId: request._id,
      },
      {
        activeServiceRequestId: null,
        isAvailable: true,
      },
      {
        new: true,
      }
    );
  }

  await request.save();

  const requestForParties = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: !!request.acceptedDriverAccountId,
  });

  const requestPublic = await loadEnrichedRequestById({
    requestId: request._id,
    includeContactInfo: false,
  });

  safeSocketEmit(() => {
    emitToRequest(request._id.toString(), 'request:status-changed', {
      request: requestPublic,
      status: request.status,
    });

    emitToAccount(request.customerAccountId.toString(), 'request:status-changed', {
      request: requestForParties,
      status: request.status,
    });

    if (request.acceptedDriverAccountId) {
      emitToAccount(
        request.acceptedDriverAccountId.toString(),
        'request:status-changed',
        {
          request: requestForParties,
          status: request.status,
        }
      );
    }

    getIO().to('admins').emit('admin:request-status-changed', {
      request: requestForParties,
      status: request.status,
    });
  });

  const statusNotifications = buildStatusNotifications(request);

  if (statusNotifications?.customer) {
    await safeCreateNotification({
      accountId: request.customerAccountId,
      title: statusNotifications.customer.title,
      body: statusNotifications.customer.body,
      type: 'request',
      data: {
        serviceRequestId: request._id,
        status: request.status,
      },
    });
  }

  if (statusNotifications?.driver && request.acceptedDriverAccountId) {
    await safeCreateNotification({
      accountId: request.acceptedDriverAccountId,
      title: statusNotifications.driver.title,
      body: statusNotifications.driver.body,
      type: 'request',
      data: {
        serviceRequestId: request._id,
        status: request.status,
      },
    });
  }

  return sendSuccess({
    res,
    message: 'تم تحديث حالة الطلب بنجاح',
    doc: requestForParties,
  });
});

module.exports = {
  createServiceRequest,
  getMyServiceRequests,
  getAvailableServiceRequestsForDriver,
  getServiceRequestById,
  createDriverOffer,
  createCustomerCounterOffer,
  acceptOffer,
  rejectOffer,
  acceptCustomerCounterOffer,
  rejectCustomerCounterOffer,
  updateServiceRequestStatus,
};