const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const ServiceRequest = require('../models/serviceRequest.model');
const ServiceOffer = require('../models/serviceOffer.model');
const DriverWallet = require('../models/driverWallet.model');
const Complaint = require('../models/complaint.model');
const SupportTicket = require('../models/supportTicket.model');
const Notification = require('../models/notification.model');
const AccountRestriction = require('../models/accountRestriction.model');
const { ACTIVE_REQUEST_STATUSES, TRIP_ACTIVE_STATUSES } = require('../services/reporting.service');

const toNumber = (value) => Number(value || 0);

const getLiveSummary = asyncHandler(async (req, res) => {
  const now = new Date();
  const staleLocationSeconds = Math.max(Number(req.query.staleLocationSeconds || 120), 30);
  const staleLocationDate = new Date(now.getTime() - staleLocationSeconds * 1000);

  const [
    onlineDrivers,
    availableDrivers,
    busyDrivers,
    staleLocationDrivers,
    activeRequests,
    activeTrips,
    pendingOffers,
    openComplaints,
    openSupportTickets,
    debtBlockedDrivers,
    activeRestrictions,
    failedPushNotifications,
    pendingDriverReviews,
  ] = await Promise.all([
    DriverProfile.countDocuments({ isOnline: true }),
    DriverProfile.countDocuments({
      isOnline: true,
      isAvailable: true,
      activeServiceRequestId: null,
      isBlockedForDebt: false,
      reviewStatus: 'approved',
      isApproved: true,
    }),
    DriverProfile.countDocuments({ isOnline: true, activeServiceRequestId: { $ne: null } }),
    DriverProfile.countDocuments({
      isOnline: true,
      $or: [
        { currentLocationUpdatedAt: null },
        { currentLocationUpdatedAt: { $lt: staleLocationDate } },
      ],
    }),
    ServiceRequest.countDocuments({ status: { $in: ACTIVE_REQUEST_STATUSES } }),
    ServiceRequest.countDocuments({ status: { $in: TRIP_ACTIVE_STATUSES } }),
    ServiceOffer.countDocuments({ status: 'pending' }),
    Complaint.countDocuments({ status: { $in: ['open', 'under_review', 'in_review'] } }),
    SupportTicket.countDocuments({ status: { $in: ['open', 'pending_user', 'pending_admin'] } }),
    DriverWallet.countDocuments({ isBlockedByDebt: true }),
    AccountRestriction.countDocuments({ isActive: true, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }),
    Notification.countDocuments({ pushStatus: { $in: ['failed', 'partial'] } }),
    DriverProfile.countDocuments({ reviewStatus: 'pending' }),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب ملخص العمليات الحية بنجاح',
    doc: {
      now,
      staleLocationSeconds,
      onlineDrivers,
      availableDrivers,
      busyDrivers,
      staleLocationDrivers,
      activeRequests,
      activeTrips,
      pendingOffers,
      openComplaints,
      openSupportTickets,
      debtBlockedDrivers,
      activeRestrictions,
      failedPushNotifications,
      pendingDriverReviews,
    },
  });
});

const getLiveDrivers = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const filters = {};

  if (req.query.online === 'true') filters.isOnline = true;
  if (req.query.online === 'false') filters.isOnline = false;
  if (req.query.available === 'true') filters.isAvailable = true;
  if (req.query.reviewStatus) filters.reviewStatus = req.query.reviewStatus;
  if (req.query.blockedByDebt === 'true') filters.isBlockedForDebt = true;

  const drivers = await DriverProfile.find(filters)
    .sort({ isOnline: -1, currentLocationUpdatedAt: -1, updatedAt: -1 })
    .limit(limit)
    .populate('accountId', 'name phone profileImage roles isActive')
    .populate('currentVehicleId')
    .select('accountId isApproved reviewStatus isOnline isAvailable isActive activeServiceRequestId currentVehicleId currentLat currentLng currentLocation currentLocationUpdatedAt ratingAverage ratingCount totalCompletedTrips commissionDebt commissionDebtLimit isBlockedForDebt blockedReason lastOnlineAt updatedAt')
    .lean();

  return sendSuccess({
    res,
    message: 'تم جلب السائقين في لوحة العمليات بنجاح',
    docs: drivers,
    extra: { count: drivers.length },
  });
});

const getLiveRequests = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 300);
  const statuses = req.query.status
    ? req.query.status.split(',').map((status) => status.trim())
    : ACTIVE_REQUEST_STATUSES;

  const filters = { status: { $in: statuses } };
  if (req.query.serviceType) filters.serviceType = req.query.serviceType;
  if (req.query.vehicleTypeCode) filters.vehicleTypeCode = req.query.vehicleTypeCode.toString().toLowerCase();

  const requests = await ServiceRequest.find(filters)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate('customerAccountId', 'name phone')
    .populate('acceptedDriverAccountId', 'name phone')
    .select('requestCode serviceType vehicleTypeCode vehicleTypeName pickup destination status customerAccountId acceptedDriverAccountId acceptedOfferId customerOfferedPrice customerPayablePrice finalPrice searchRadiusKm createdAt updatedAt scheduledAt')
    .lean();

  return sendSuccess({
    res,
    message: 'تم جلب الطلبات الحية بنجاح',
    docs: requests,
    extra: { count: requests.length },
  });
});

const getLiveTrips = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 100), 300);
  const filters = { status: { $in: TRIP_ACTIVE_STATUSES } };

  if (req.query.driverAccountId) filters.acceptedDriverAccountId = req.query.driverAccountId;
  if (req.query.customerAccountId) filters.customerAccountId = req.query.customerAccountId;

  const trips = await ServiceRequest.find(filters)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .populate('customerAccountId', 'name phone')
    .populate('acceptedDriverAccountId', 'name phone')
    .populate('acceptedDriverVehicleId')
    .select('requestCode serviceType vehicleTypeCode vehicleTypeName pickup destination status customerAccountId acceptedDriverAccountId acceptedDriverVehicleId finalPrice customerPayablePrice commissionAmount startedAt createdAt updatedAt')
    .lean();

  return sendSuccess({
    res,
    message: 'تم جلب الرحلات الحية بنجاح',
    docs: trips,
    extra: { count: trips.length },
  });
});

const getLiveIssues = asyncHandler(async (req, res) => {
  const now = new Date();
  const staleLocationSeconds = Math.max(Number(req.query.staleLocationSeconds || 120), 30);
  const staleLocationDate = new Date(now.getTime() - staleLocationSeconds * 1000);
  const limit = Math.min(Number(req.query.limit || 50), 200);

  const [staleDrivers, debtBlockedDrivers, failedNotifications, urgentComplaints, urgentTickets, activeRestrictions] = await Promise.all([
    DriverProfile.find({
      isOnline: true,
      $or: [
        { currentLocationUpdatedAt: null },
        { currentLocationUpdatedAt: { $lt: staleLocationDate } },
      ],
    })
      .sort({ currentLocationUpdatedAt: 1 })
      .limit(limit)
      .populate('accountId', 'name phone')
      .select('accountId currentLat currentLng currentLocationUpdatedAt activeServiceRequestId')
      .lean(),
    DriverWallet.find({ isBlockedByDebt: true })
      .sort({ debtAmount: -1 })
      .limit(limit)
      .populate('driverAccountId', 'name phone')
      .select('driverAccountId payableBalance debtAmount debtLimit updatedAt')
      .lean(),
    Notification.find({ pushStatus: { $in: ['failed', 'partial'] } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('accountId', 'name phone')
      .select('accountId title type pushStatus pushResult createdAt')
      .lean(),
    Complaint.find({ priority: { $in: ['high', 'urgent'] }, status: { $in: ['open', 'under_review', 'in_review'] } })
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .populate('fromAccountId', 'name phone')
      .select('complaintCode serviceRequestId fromAccountId category title priority status createdAt')
      .lean(),
    SupportTicket.find({ priority: { $in: ['high', 'urgent'] }, status: { $in: ['open', 'pending_user', 'pending_admin'] } })
      .sort({ priority: -1, createdAt: -1 })
      .limit(limit)
      .populate('accountId', 'name phone')
      .select('ticketCode accountId subject category priority status createdAt')
      .lean(),
    AccountRestriction.find({ isActive: true, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('accountId', 'name phone roles')
      .select('accountId restrictionType reason startsAt endsAt createdAt')
      .lean(),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب مشاكل العمليات الحية بنجاح',
    doc: {
      staleLocationSeconds,
      staleDrivers,
      debtBlockedDrivers,
      failedNotifications,
      urgentComplaints,
      urgentTickets,
      activeRestrictions,
      totals: {
        staleDrivers: staleDrivers.length,
        debtBlockedDrivers: debtBlockedDrivers.length,
        failedNotifications: failedNotifications.length,
        urgentComplaints: urgentComplaints.length,
        urgentTickets: urgentTickets.length,
        activeRestrictions: activeRestrictions.length,
      },
    },
  });
});

const getLiveMap = asyncHandler(async (req, res) => {
  const driverLimit = Math.min(Number(req.query.driverLimit || 500), 1000);
  const requestLimit = Math.min(Number(req.query.requestLimit || 200), 500);

  const [drivers, requests] = await Promise.all([
    DriverProfile.find({ isOnline: true, currentLat: { $ne: null }, currentLng: { $ne: null } })
      .sort({ currentLocationUpdatedAt: -1 })
      .limit(driverLimit)
      .populate('accountId', 'name phone')
      .select('accountId isAvailable activeServiceRequestId currentLat currentLng currentLocationUpdatedAt ratingAverage commissionDebt isBlockedForDebt')
      .lean(),
    ServiceRequest.find({ status: { $in: ACTIVE_REQUEST_STATUSES } })
      .sort({ updatedAt: -1 })
      .limit(requestLimit)
      .select('requestCode serviceType vehicleTypeCode pickup destination status acceptedDriverAccountId customerAccountId createdAt updatedAt')
      .lean(),
  ]);

  return sendSuccess({
    res,
    message: 'تم جلب خريطة العمليات الحية بنجاح',
    doc: {
      drivers,
      requests,
      counts: {
        drivers: drivers.length,
        requests: requests.length,
      },
    },
  });
});

module.exports = {
  getLiveSummary,
  getLiveDrivers,
  getLiveRequests,
  getLiveTrips,
  getLiveIssues,
  getLiveMap,
};
