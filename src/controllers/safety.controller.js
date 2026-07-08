const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const {
  createIncident,
  listIncidents,
  populateIncident,
  updateIncidentStatus,
} = require('../services/safety.service');
const SafetyIncident = require('../models/safetyIncident.model');

const createSafetyIncident = asyncHandler(async (req, res) => {
  const incident = await createIncident({
    account: req.account,
    accountId: req.accountId,
    body: req.body,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال بلاغ الأمان وفريق توصيلة يتابع الآن',
    doc: incident,
  });
});

const getMySafetyIncidents = asyncHandler(async (req, res) => {
  const { docs, pagination } = await listIncidents({
    query: req.query,
    isAdmin: false,
    accountId: req.accountId,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بلاغات الأمان الخاصة بك',
    docs,
    extra: { pagination },
  });
});

const getSafetyIncidentById = asyncHandler(async (req, res) => {
  const incident = await populateIncident(SafetyIncident.findById(req.params.id));

  if (!incident) {
    const error = new Error('بلاغ الأمان غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const isAdmin = req.account?.roles?.includes('admin');
  const accountId = req.accountId?.toString();
  const hasAccess = isAdmin ||
    incident.reporterAccountId?._id?.toString() === accountId ||
    incident.customerAccountId?._id?.toString() === accountId ||
    incident.driverAccountId?._id?.toString() === accountId;

  if (!hasAccess) {
    const error = new Error('غير مسموح لك بفتح هذا البلاغ');
    error.statusCode = 403;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب بلاغ الأمان',
    doc: incident,
  });
});

const getAllSafetyIncidentsForAdmin = asyncHandler(async (req, res) => {
  const { docs, pagination } = await listIncidents({
    query: req.query,
    isAdmin: true,
  });

  return sendSuccess({
    res,
    message: 'تم جلب بلاغات الأمان',
    docs,
    extra: { pagination },
  });
});

const updateSafetyIncidentByAdmin = asyncHandler(async (req, res) => {
  const incident = await updateIncidentStatus({
    incidentId: req.params.id,
    adminAccountId: req.accountId,
    body: req.body,
  });

  return sendSuccess({
    res,
    message: 'تم تحديث بلاغ الأمان',
    doc: incident,
  });
});

module.exports = {
  createSafetyIncident,
  getMySafetyIncidents,
  getSafetyIncidentById,
  getAllSafetyIncidentsForAdmin,
  updateSafetyIncidentByAdmin,
};
