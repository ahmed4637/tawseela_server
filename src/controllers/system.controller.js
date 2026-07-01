const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { getReadinessSnapshot } = require('../services/startup.service');
const { getWorkerStatus } = require('../workers/scheduledReminder.worker');

const getSystemHealth = asyncHandler(async (req, res) => {
  return sendSuccess({
    res,
    message: 'Tawseela API is running',
    extra: {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      worker: getWorkerStatus(),
    },
  });
});

const getSystemReadiness = asyncHandler(async (req, res) => {
  const snapshot = await getReadinessSnapshot();

  return sendSuccess({
    res,
    statusCode: snapshot.status === 'ready' ? 200 : 503,
    message: snapshot.status === 'ready'
      ? 'النظام جاهز للتشغيل'
      : 'النظام غير جاهز بالكامل',
    extra: {
      readiness: snapshot,
      worker: getWorkerStatus(),
    },
  });
});

module.exports = {
  getSystemHealth,
  getSystemReadiness,
};
