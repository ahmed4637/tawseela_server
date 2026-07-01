const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const DriverReviewLog = require('../models/driverReviewLog.model');
const { createAdminAuditLog } = require('./adminAuditLog.service');
const { createNotification } = require('./notification.service');
const { emitToAccount } = require('../sockets/socket.server');

const normalizeReason = (reason, fallback = '') => {
  const cleanReason = reason ? reason.toString().trim() : '';
  return cleanReason || fallback;
};

const toPlain = (doc) => {
  if (!doc) {
    return null;
  }

  return doc.toObject ? doc.toObject() : JSON.parse(JSON.stringify(doc));
};

const createReviewLog = async ({
  entityType,
  driverProfileId = null,
  driverVehicleId = null,
  accountId,
  action,
  oldReviewStatus = '',
  newReviewStatus = '',
  reason = '',
  adminAccountId = null,
  source = 'system',
  metadata = {},
}) => {
  return DriverReviewLog.create({
    entityType,
    driverProfileId,
    driverVehicleId,
    accountId,
    action,
    oldReviewStatus,
    newReviewStatus,
    reason,
    adminAccountId,
    source,
    metadata,
  });
};

const notifyDriverReview = async ({ accountId, title, body, data = {} }) => {
  if (!accountId) {
    return;
  }

  try {
    await createNotification({
      accountId,
      title,
      body,
      type: 'review',
      data,
    });
  } catch (error) {
    console.error('Driver review notification error:', error.message);
  }
};

const emitDriverReviewUpdate = ({ accountId, payload }) => {
  if (!accountId) {
    return;
  }

  try {
    emitToAccount(accountId.toString(), 'driver:review-updated', payload);
  } catch (error) {
    console.error('Driver review socket error:', error.message);
  }
};

const getApprovedActiveVehicle = async (accountId) => {
  return DriverVehicle.findOne({
    accountId,
    isActive: true,
    isApproved: true,
    reviewStatus: 'approved',
  }).sort({ isDefault: -1, approvedAt: -1, createdAt: -1 });
};

const syncDriverVehicleAvailability = async (accountId) => {
  const profile = await DriverProfile.findOne({ accountId });

  if (!profile) {
    return null;
  }

  const approvedVehicle = await getApprovedActiveVehicle(accountId);

  if (!approvedVehicle) {
    profile.currentVehicleId = null;
    profile.isOnline = false;
    profile.isAvailable = false;

    if (profile.reviewStatus === 'approved') {
      profile.blockedReason = 'لا توجد مركبة مقبولة ونشطة لاستقبال الطلبات';
    }
  } else {
    if (!profile.currentVehicleId) {
      profile.currentVehicleId = approvedVehicle._id;
    }

    if (profile.reviewStatus === 'approved' && !profile.isBlockedForDebt) {
      profile.isAvailable = true;

      if (profile.blockedReason === 'لا توجد مركبة مقبولة ونشطة لاستقبال الطلبات') {
        profile.blockedReason = '';
      }
    }
  }

  await profile.save();
  return profile;
};

const approveDriverProfile = async ({ driverProfileId, req, reason = '' }) => {
  const profile = await DriverProfile.findById(driverProfileId);

  if (!profile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = toPlain(profile);
  const oldReviewStatus = profile.reviewStatus;

  profile.isApproved = true;
  profile.reviewStatus = 'approved';
  profile.rejectionReason = '';
  profile.approvedAt = new Date();
  profile.reviewedAt = new Date();
  profile.reviewedBy = req.accountId;
  profile.isActive = true;

  const approvedVehicle = await getApprovedActiveVehicle(profile.accountId);
  profile.currentVehicleId = approvedVehicle?._id || profile.currentVehicleId || null;
  profile.isAvailable = Boolean(approvedVehicle) && !profile.isBlockedForDebt;

  if (!approvedVehicle) {
    profile.isOnline = false;
    profile.blockedReason = 'تمت الموافقة على السائق، لكن يلزم قبول مركبة واحدة على الأقل قبل استقبال الطلبات';
  } else if (!profile.isBlockedForDebt) {
    profile.blockedReason = '';
  }

  await profile.save();

  await createReviewLog({
    entityType: 'driver_profile',
    driverProfileId: profile._id,
    accountId: profile.accountId,
    action: 'approved',
    oldReviewStatus,
    newReviewStatus: profile.reviewStatus,
    reason: normalizeReason(reason, 'تمت الموافقة على ملف السائق'),
    adminAccountId: req.accountId,
    source: 'admin_dashboard',
  });

  await createAdminAuditLog({
    req,
    module: 'driver_review',
    action: 'approve_driver_profile',
    entityType: 'DriverProfile',
    entityId: profile._id,
    oldValue,
    newValue: profile,
    reason: normalizeReason(reason, 'تمت الموافقة على ملف السائق'),
  });

  await notifyDriverReview({
    accountId: profile.accountId,
    title: 'تمت الموافقة على حساب السائق',
    body: approvedVehicle
      ? 'تمت الموافقة على حسابك كسائق ويمكنك تفعيل الحالة Online بعد تأكيد السيرفر.'
      : 'تمت الموافقة على حسابك كسائق، وفي انتظار قبول مركبة واحدة على الأقل قبل تفعيل Online.',
    data: {
      driverProfileId: profile._id.toString(),
      reviewStatus: profile.reviewStatus,
      hasApprovedVehicle: Boolean(approvedVehicle),
    },
  });

  emitDriverReviewUpdate({
    accountId: profile.accountId,
    payload: {
      entityType: 'driver_profile',
      driverProfileId: profile._id,
      reviewStatus: profile.reviewStatus,
      isApproved: profile.isApproved,
      hasApprovedVehicle: Boolean(approvedVehicle),
    },
  });

  return profile;
};

const rejectOrRequestUpdateDriverProfile = async ({
  driverProfileId,
  req,
  reason,
  action,
}) => {
  const profile = await DriverProfile.findById(driverProfileId);

  if (!profile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const isNeedsUpdate = action === 'needs_update';
  const finalReason = normalizeReason(
    reason,
    isNeedsUpdate ? 'مطلوب تعديل بيانات السائق' : 'تم رفض طلب السائق'
  );
  const oldValue = toPlain(profile);
  const oldReviewStatus = profile.reviewStatus;

  profile.isApproved = false;
  profile.reviewStatus = isNeedsUpdate ? 'needs_update' : 'rejected';
  profile.rejectionReason = finalReason;
  profile.approvedAt = null;
  profile.reviewedAt = new Date();
  profile.reviewedBy = req.accountId;
  profile.isOnline = false;
  profile.isAvailable = false;
  profile.currentVehicleId = null;
  profile.blockedReason = finalReason;

  await profile.save();

  await createReviewLog({
    entityType: 'driver_profile',
    driverProfileId: profile._id,
    accountId: profile.accountId,
    action: isNeedsUpdate ? 'needs_update' : 'rejected',
    oldReviewStatus,
    newReviewStatus: profile.reviewStatus,
    reason: finalReason,
    adminAccountId: req.accountId,
    source: 'admin_dashboard',
  });

  await createAdminAuditLog({
    req,
    module: 'driver_review',
    action: isNeedsUpdate ? 'request_update_driver_profile' : 'reject_driver_profile',
    entityType: 'DriverProfile',
    entityId: profile._id,
    oldValue,
    newValue: profile,
    reason: finalReason,
  });

  await notifyDriverReview({
    accountId: profile.accountId,
    title: isNeedsUpdate ? 'مطلوب تعديل بيانات السائق' : 'تم رفض حساب السائق',
    body: finalReason,
    data: {
      driverProfileId: profile._id.toString(),
      reviewStatus: profile.reviewStatus,
      reason: finalReason,
    },
  });

  emitDriverReviewUpdate({
    accountId: profile.accountId,
    payload: {
      entityType: 'driver_profile',
      driverProfileId: profile._id,
      reviewStatus: profile.reviewStatus,
      isApproved: profile.isApproved,
      rejectionReason: finalReason,
    },
  });

  return profile;
};

const approveDriverVehicle = async ({ driverVehicleId, req, reason = '' }) => {
  const vehicle = await DriverVehicle.findById(driverVehicleId);

  if (!vehicle) {
    const error = new Error('مركبة السائق غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const oldValue = toPlain(vehicle);
  const oldReviewStatus = vehicle.reviewStatus;

  vehicle.isApproved = true;
  vehicle.reviewStatus = 'approved';
  vehicle.rejectionReason = '';
  vehicle.approvedAt = new Date();
  vehicle.reviewedAt = new Date();
  vehicle.reviewedBy = req.accountId;
  vehicle.isActive = true;

  const approvedVehiclesCount = await DriverVehicle.countDocuments({
    accountId: vehicle.accountId,
    isActive: true,
    isApproved: true,
    reviewStatus: 'approved',
    _id: { $ne: vehicle._id },
  });

  if (approvedVehiclesCount === 0) {
    vehicle.isDefault = true;
  }

  await vehicle.save();

  if (vehicle.isDefault) {
    await DriverVehicle.updateMany(
      {
        accountId: vehicle.accountId,
        _id: { $ne: vehicle._id },
      },
      { isDefault: false }
    );
  }

  const profile = await syncDriverVehicleAvailability(vehicle.accountId);

  await createReviewLog({
    entityType: 'driver_vehicle',
    driverProfileId: profile?._id || null,
    driverVehicleId: vehicle._id,
    accountId: vehicle.accountId,
    action: 'approved',
    oldReviewStatus,
    newReviewStatus: vehicle.reviewStatus,
    reason: normalizeReason(reason, 'تمت الموافقة على مركبة السائق'),
    adminAccountId: req.accountId,
    source: 'admin_dashboard',
  });

  await createAdminAuditLog({
    req,
    module: 'driver_review',
    action: 'approve_driver_vehicle',
    entityType: 'DriverVehicle',
    entityId: vehicle._id,
    oldValue,
    newValue: vehicle,
    reason: normalizeReason(reason, 'تمت الموافقة على مركبة السائق'),
  });

  await notifyDriverReview({
    accountId: vehicle.accountId,
    title: 'تمت الموافقة على المركبة',
    body: profile?.reviewStatus === 'approved'
      ? 'تمت الموافقة على مركبتك ويمكنك تفعيل الحالة Online بعد تأكيد السيرفر.'
      : 'تمت الموافقة على المركبة وفي انتظار مراجعة حساب السائق.',
    data: {
      driverVehicleId: vehicle._id.toString(),
      reviewStatus: vehicle.reviewStatus,
      driverReviewStatus: profile?.reviewStatus || '',
    },
  });

  emitDriverReviewUpdate({
    accountId: vehicle.accountId,
    payload: {
      entityType: 'driver_vehicle',
      driverVehicleId: vehicle._id,
      reviewStatus: vehicle.reviewStatus,
      isApproved: vehicle.isApproved,
      driverReviewStatus: profile?.reviewStatus || '',
      canGoOnline: Boolean(profile?.reviewStatus === 'approved' && profile.isApproved),
    },
  });

  return vehicle;
};

const rejectOrRequestUpdateDriverVehicle = async ({
  driverVehicleId,
  req,
  reason,
  action,
}) => {
  const vehicle = await DriverVehicle.findById(driverVehicleId);

  if (!vehicle) {
    const error = new Error('مركبة السائق غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  const isNeedsUpdate = action === 'needs_update';
  const finalReason = normalizeReason(
    reason,
    isNeedsUpdate ? 'مطلوب تعديل بيانات المركبة' : 'تم رفض المركبة'
  );
  const oldValue = toPlain(vehicle);
  const oldReviewStatus = vehicle.reviewStatus;

  vehicle.isApproved = false;
  vehicle.reviewStatus = isNeedsUpdate ? 'needs_update' : 'rejected';
  vehicle.rejectionReason = finalReason;
  vehicle.approvedAt = null;
  vehicle.reviewedAt = new Date();
  vehicle.reviewedBy = req.accountId;

  await vehicle.save();

  const profile = await syncDriverVehicleAvailability(vehicle.accountId);

  await createReviewLog({
    entityType: 'driver_vehicle',
    driverProfileId: profile?._id || null,
    driverVehicleId: vehicle._id,
    accountId: vehicle.accountId,
    action: isNeedsUpdate ? 'needs_update' : 'rejected',
    oldReviewStatus,
    newReviewStatus: vehicle.reviewStatus,
    reason: finalReason,
    adminAccountId: req.accountId,
    source: 'admin_dashboard',
  });

  await createAdminAuditLog({
    req,
    module: 'driver_review',
    action: isNeedsUpdate ? 'request_update_driver_vehicle' : 'reject_driver_vehicle',
    entityType: 'DriverVehicle',
    entityId: vehicle._id,
    oldValue,
    newValue: vehicle,
    reason: finalReason,
  });

  await notifyDriverReview({
    accountId: vehicle.accountId,
    title: isNeedsUpdate ? 'مطلوب تعديل بيانات المركبة' : 'تم رفض المركبة',
    body: finalReason,
    data: {
      driverVehicleId: vehicle._id.toString(),
      reviewStatus: vehicle.reviewStatus,
      reason: finalReason,
      driverReviewStatus: profile?.reviewStatus || '',
    },
  });

  emitDriverReviewUpdate({
    accountId: vehicle.accountId,
    payload: {
      entityType: 'driver_vehicle',
      driverVehicleId: vehicle._id,
      reviewStatus: vehicle.reviewStatus,
      isApproved: vehicle.isApproved,
      rejectionReason: finalReason,
      driverReviewStatus: profile?.reviewStatus || '',
      canGoOnline: Boolean(profile?.reviewStatus === 'approved' && profile.isApproved),
    },
  });

  return vehicle;
};

const buildDriverReviewStatus = async (accountId) => {
  const [profile, vehicles, logs] = await Promise.all([
    DriverProfile.findOne({ accountId }),
    DriverVehicle.find({ accountId, isActive: true }).sort({ isDefault: -1, createdAt: -1 }),
    DriverReviewLog.find({ accountId })
      .sort({ createdAt: -1 })
      .limit(20),
  ]);

  const approvedVehiclesCount = vehicles.filter(
    (vehicle) => vehicle.isApproved && vehicle.reviewStatus === 'approved'
  ).length;

  const canGoOnline = Boolean(
    profile &&
      profile.isApproved &&
      profile.reviewStatus === 'approved' &&
      approvedVehiclesCount > 0 &&
      !profile.isBlockedForDebt
  );

  return {
    driverProfile: profile,
    driverVehicles: vehicles,
    approvedVehiclesCount,
    canGoOnline,
    reviewLogs: logs,
    blockingReasons: {
      profile: !profile
        ? 'ملف السائق غير موجود'
        : profile.reviewStatus !== 'approved'
          ? profile.rejectionReason || 'ملف السائق تحت المراجعة'
          : '',
      vehicle: approvedVehiclesCount === 0
        ? 'لا توجد مركبة مقبولة ونشطة'
        : '',
      debt: profile?.isBlockedForDebt ? profile.blockedReason : '',
    },
  };
};

const markDriverProfileResubmitted = async ({ accountId, reason = 'إعادة إرسال بيانات السائق للمراجعة' }) => {
  const profile = await DriverProfile.findOne({ accountId });

  if (!profile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const oldReviewStatus = profile.reviewStatus;

  if (['rejected', 'needs_update'].includes(profile.reviewStatus)) {
    profile.reviewStatus = 'pending';
    profile.isApproved = false;
    profile.rejectionReason = '';
    profile.approvedAt = null;
    profile.reviewedAt = null;
    profile.reviewedBy = null;
    profile.isOnline = false;
    profile.isAvailable = false;
    await profile.save();
  }

  await createReviewLog({
    entityType: 'driver_profile',
    driverProfileId: profile._id,
    accountId: profile.accountId,
    action: 'resubmitted',
    oldReviewStatus,
    newReviewStatus: profile.reviewStatus,
    reason,
    source: 'driver_app',
  });

  return profile;
};

const markDriverVehicleResubmitted = async ({ vehicle, reason = 'إعادة إرسال بيانات المركبة للمراجعة' }) => {
  const oldReviewStatus = vehicle.reviewStatus;

  if (['rejected', 'needs_update'].includes(vehicle.reviewStatus)) {
    vehicle.reviewStatus = 'pending';
    vehicle.isApproved = false;
    vehicle.rejectionReason = '';
    vehicle.approvedAt = null;
    vehicle.reviewedAt = null;
    vehicle.reviewedBy = null;
    await vehicle.save();
  }

  await createReviewLog({
    entityType: 'driver_vehicle',
    driverVehicleId: vehicle._id,
    accountId: vehicle.accountId,
    action: 'resubmitted',
    oldReviewStatus,
    newReviewStatus: vehicle.reviewStatus,
    reason,
    source: 'driver_app',
  });

  return vehicle;
};

module.exports = {
  approveDriverProfile,
  rejectOrRequestUpdateDriverProfile,
  approveDriverVehicle,
  rejectOrRequestUpdateDriverVehicle,
  buildDriverReviewStatus,
  markDriverProfileResubmitted,
  markDriverVehicleResubmitted,
  syncDriverVehicleAvailability,
  createReviewLog,
};
