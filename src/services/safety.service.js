const SafetyIncident = require('../models/safetyIncident.model');
const ServiceRequest = require('../models/serviceRequest.model');
const { createNotification } = require('./notification.service');

const ACTIVE_TRIP_STATUSES = [
  'offer_accepted',
  'driver_arriving',
  'arrived_to_pickup',
  'in_progress',
];

const normalizeReporterRole = (account) => {
  if (account?.roles?.includes('driver')) return 'driver';
  if (account?.roles?.includes('customer') || account?.roles?.includes('user')) return 'customer';
  if (account?.roles?.includes('admin')) return 'admin';
  return 'unknown';
};

const sanitizeIncidentType = (type) => {
  const allowed = [
    'emergency',
    'unsafe_behavior',
    'accident',
    'route_issue',
    'vehicle_issue',
    'payment_conflict',
    'other',
  ];

  return allowed.includes(type) ? type : 'emergency';
};

const sanitizeSeverity = (severity) => {
  const allowed = ['low', 'medium', 'high', 'critical'];
  return allowed.includes(severity) ? severity : 'critical';
};

const sanitizeStatus = (status) => {
  const allowed = ['open', 'acknowledged', 'in_progress', 'resolved', 'closed'];
  return allowed.includes(status) ? status : '';
};

const readRequestAccess = async ({ serviceRequestId, accountId, isAdmin = false }) => {
  const request = await ServiceRequest.findById(serviceRequestId)
    .populate('customerAccountId', 'name phone email profileImage roles')
    .populate('acceptedDriverAccountId', 'name phone email profileImage roles')
    .populate('acceptedDriverVehicleId')
    .populate('vehicleTypeId');

  if (!request) {
    const error = new Error('الطلب المرتبط غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (isAdmin) {
    return request;
  }

  const isCustomer = request.customerAccountId?._id?.toString() === accountId?.toString();
  const isDriver = request.acceptedDriverAccountId?._id?.toString() === accountId?.toString();

  if (!isCustomer && !isDriver) {
    const error = new Error('غير مسموح لك بإنشاء بلاغ أمان على هذا الطلب');
    error.statusCode = 403;
    throw error;
  }

  if (!ACTIVE_TRIP_STATUSES.includes(request.status)) {
    const error = new Error('بلاغات الأمان متاحة أثناء الرحلة أو أثناء توجه السائق فقط');
    error.statusCode = 400;
    throw error;
  }

  return request;
};

const populateIncident = (query) => query
  .populate('serviceRequestId')
  .populate('reporterAccountId', 'name phone email profileImage roles')
  .populate('customerAccountId', 'name phone email profileImage roles')
  .populate('driverAccountId', 'name phone email profileImage roles')
  .populate('acknowledgedByAdminId', 'name phone email')
  .populate('resolvedByAdminId', 'name phone email');

const emitSafetyEvent = (eventName, payload) => {
  try {
    // eslint-disable-next-line global-require
    const { emitToAdmins, emitToRequest, emitToAccount } = require('../sockets/socket.server');

    emitToAdmins(eventName, payload);

    if (payload.serviceRequestId) {
      emitToRequest(payload.serviceRequestId.toString(), eventName, payload);
    }

    if (payload.customerAccountId) {
      emitToAccount(payload.customerAccountId.toString(), eventName, payload);
    }

    if (payload.driverAccountId) {
      emitToAccount(payload.driverAccountId.toString(), eventName, payload);
    }
  } catch (error) {
    // Socket may be unavailable in scripts/tests.
  }
};

const notifySafetyParties = async ({ incident, reporterAccountId }) => {
  const receiverIds = [
    incident.customerAccountId?.toString(),
    incident.driverAccountId?.toString(),
  ]
    .filter(Boolean)
    .filter((id) => id !== reporterAccountId?.toString());

  await Promise.allSettled(
    receiverIds.map((accountId) => createNotification({
      accountId,
      title: 'بلاغ أمان داخل الرحلة',
      body: 'تم تسجيل بلاغ أمان عاجل على الرحلة، فريق توصيلة يتابع الآن',
      type: 'complaint',
      data: {
        incidentId: incident._id,
        incidentCode: incident.incidentCode,
        serviceRequestId: incident.serviceRequestId,
        requestId: incident.serviceRequestId,
      },
    })),
  );
};

const createIncident = async ({ account, accountId, body = {} }) => {
  const serviceRequestId = (
    body.serviceRequestId ||
    body.requestId ||
    body.rideId ||
    ''
  ).toString().trim();

  if (!serviceRequestId) {
    const error = new Error('رقم الطلب مطلوب لإنشاء بلاغ أمان');
    error.statusCode = 400;
    throw error;
  }

  const request = await readRequestAccess({
    serviceRequestId,
    accountId,
    isAdmin: account?.roles?.includes('admin'),
  });

  const reporterRole = normalizeReporterRole(account);
  const lat = Number(body.lat ?? body.latitude);
  const lng = Number(body.lng ?? body.longitude);
  const hasValidLocation = Number.isFinite(lat) && Number.isFinite(lng);

  const incident = await SafetyIncident.create({
    serviceRequestId: request._id,
    reporterAccountId: accountId,
    reporterRole,
    customerAccountId: request.customerAccountId?._id || request.customerAccountId || null,
    driverAccountId: request.acceptedDriverAccountId?._id || request.acceptedDriverAccountId || null,
    type: sanitizeIncidentType(body.type?.toString()),
    severity: sanitizeSeverity(body.severity?.toString()),
    title: body.title?.toString().trim() || 'بلاغ أمان عاجل',
    message: body.message?.toString().trim() || 'تم إرسال بلاغ أمان من داخل الرحلة',
    location: {
      lat: hasValidLocation ? lat : null,
      lng: hasValidLocation ? lng : null,
      address: body.address?.toString().trim() || '',
      capturedAt: hasValidLocation ? new Date() : null,
    },
    metadata: {
      platform: body.platform || null,
      appVersion: body.appVersion || null,
      source: body.source || 'mobile_app',
    },
  });

  const populated = await populateIncident(SafetyIncident.findById(incident._id));
  const payload = {
    incident: populated,
    incidentId: populated._id,
    incidentCode: populated.incidentCode,
    serviceRequestId: request._id,
    requestId: request._id,
    customerAccountId: populated.customerAccountId?._id || populated.customerAccountId,
    driverAccountId: populated.driverAccountId?._id || populated.driverAccountId,
  };

  emitSafetyEvent('safety:incident-created', payload);

  setImmediate(() => {
    notifySafetyParties({ incident: populated, reporterAccountId: accountId }).catch((error) => {
      console.error('Safety notification error:', error.message);
    });
  });

  return populated;
};

const listIncidents = async ({ query = {}, isAdmin = false, accountId = null }) => {
  const {
    status,
    severity,
    serviceRequestId,
    requestId,
    page = 1,
    limit = 30,
  } = query;

  const filter = {};

  if (!isAdmin) {
    filter.$or = [
      { reporterAccountId: accountId },
      { customerAccountId: accountId },
      { driverAccountId: accountId },
    ];
  }

  const cleanStatus = sanitizeStatus(status?.toString());
  if (cleanStatus) filter.status = cleanStatus;

  const cleanSeverity = sanitizeSeverity(severity?.toString());
  if (severity && cleanSeverity) filter.severity = cleanSeverity;

  const cleanRequestId = (serviceRequestId || requestId || '').toString().trim();
  if (cleanRequestId) filter.serviceRequestId = cleanRequestId;

  const pageNumber = Math.max(Number(page) || 1, 1);
  const limitNumber = Math.min(Math.max(Number(limit) || 30, 1), 100);
  const skip = (pageNumber - 1) * limitNumber;

  const [docs, total] = await Promise.all([
    populateIncident(
      SafetyIncident.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNumber),
    ),
    SafetyIncident.countDocuments(filter),
  ]);

  return {
    docs,
    pagination: {
      page: pageNumber,
      limit: limitNumber,
      total,
      pages: Math.ceil(total / limitNumber),
    },
  };
};

const updateIncidentStatus = async ({ incidentId, adminAccountId, body = {} }) => {
  const incident = await SafetyIncident.findById(incidentId);

  if (!incident) {
    const error = new Error('بلاغ الأمان غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const cleanStatus = sanitizeStatus(body.status?.toString());
  if (!cleanStatus) {
    const error = new Error('حالة البلاغ غير صحيحة');
    error.statusCode = 400;
    throw error;
  }

  incident.status = cleanStatus;
  incident.lastAdminNote = body.adminNote?.toString().trim() || incident.lastAdminNote || '';

  if (cleanStatus === 'acknowledged' || cleanStatus === 'in_progress') {
    incident.acknowledgedByAdminId = adminAccountId;
    incident.acknowledgedAt = incident.acknowledgedAt || new Date();
  }

  if (cleanStatus === 'resolved' || cleanStatus === 'closed') {
    incident.resolvedByAdminId = adminAccountId;
    incident.resolvedAt = new Date();
  }

  await incident.save();

  const populated = await populateIncident(SafetyIncident.findById(incident._id));

  const payload = {
    incident: populated,
    incidentId: populated._id,
    incidentCode: populated.incidentCode,
    serviceRequestId: populated.serviceRequestId?._id || populated.serviceRequestId,
    requestId: populated.serviceRequestId?._id || populated.serviceRequestId,
    customerAccountId: populated.customerAccountId?._id || populated.customerAccountId,
    driverAccountId: populated.driverAccountId?._id || populated.driverAccountId,
  };

  emitSafetyEvent('safety:incident-updated', payload);

  return populated;
};

module.exports = {
  ACTIVE_TRIP_STATUSES,
  normalizeReporterRole,
  readRequestAccess,
  populateIncident,
  createIncident,
  listIncidents,
  updateIncidentStatus,
};
