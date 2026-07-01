const {
  runScheduledRequestTick,
} = require('../services/scheduledRequest.service');
const {
  getRequestLifecycleSettings,
} = require('../services/appSettings.service');

let reminderInterval = null;
let lastTickAt = null;
let lastTickResult = null;
let lastTickError = null;

const runWorkerTickSafely = async () => {
  try {
    const result = await runScheduledRequestTick();

    lastTickAt = new Date();
    lastTickResult = result;
    lastTickError = null;

    if (
      result.dispatchedCount > 0 ||
      result.expiredRequestsCount > 0 ||
      result.expiredOffersCount > 0
    ) {
      console.log('Scheduled request worker tick:', result);
    }
  } catch (error) {
    lastTickAt = new Date();
    lastTickError = error.message;
    console.error('Scheduled request worker error:', error.message);
  }
};

const startScheduledReminderWorker = async () => {
  if (reminderInterval) {
    return;
  }

  const settings = await getRequestLifecycleSettings();
  const intervalMs = Math.max(Number(settings.workerIntervalSeconds || 60), 15) * 1000;

  await runWorkerTickSafely();

  reminderInterval = setInterval(() => {
    runWorkerTickSafely();
  }, intervalMs);

  console.log(`Scheduled request worker is running every ${Math.round(intervalMs / 1000)} seconds`);
};

const stopScheduledReminderWorker = () => {
  if (!reminderInterval) {
    return;
  }

  clearInterval(reminderInterval);
  reminderInterval = null;
};

const getWorkerStatus = () => {
  return {
    isRunning: Boolean(reminderInterval),
    lastTickAt: lastTickAt ? lastTickAt.toISOString() : null,
    lastTickResult,
    lastTickError,
  };
};

module.exports = {
  startScheduledReminderWorker,
  stopScheduledReminderWorker,
  getWorkerStatus,
};
