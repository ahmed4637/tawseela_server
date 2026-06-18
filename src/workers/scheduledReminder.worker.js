const ServiceRequest = require('../models/serviceRequest.model');
const { createNotification } = require('../services/notification.service');

let reminderInterval = null;

const getDiffMinutes = (targetDate) => {
  const now = new Date();
  return Math.floor((new Date(targetDate).getTime() - now.getTime()) / 60000);
};

const sendReminderIfNeeded = async ({ request, key, title, body }) => {
  if (request.reminderStatus?.[key] === true) {
    return;
  }

  await createNotification({
    accountId: request.customerAccountId,
    title,
    body,
    type: 'scheduled_reminder',
    data: {
      serviceRequestId: request._id,
      requestCode: request.requestCode,
      reminderKey: key,
    },
  });

  if (request.acceptedDriverAccountId) {
    await createNotification({
      accountId: request.acceptedDriverAccountId,
      title,
      body,
      type: 'scheduled_reminder',
      data: {
        serviceRequestId: request._id,
        requestCode: request.requestCode,
        reminderKey: key,
      },
    });
  }

  request.reminderStatus[key] = true;
  await request.save();
};

const checkScheduledRideReminders = async () => {
  try {
    const now = new Date();
    const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000 + 5 * 60 * 1000);

    const requests = await ServiceRequest.find({
      serviceType: 'scheduled_ride',
      status: {
        $in: ['offer_accepted', 'driver_arriving', 'arrived_to_pickup'],
      },
      scheduledAt: {
        $gte: now,
        $lte: inTwoHours,
      },
    });

    for (const request of requests) {
      const diffMinutes = getDiffMinutes(request.scheduledAt);

      if (diffMinutes <= 120 && diffMinutes > 60) {
        await sendReminderIfNeeded({
          request,
          key: 'twoHours',
          title: 'تذكير بالحجز',
          body: 'متبقي حوالي ساعتين على موعد الرحلة المجدولة',
        });
      }

      if (diffMinutes <= 60 && diffMinutes > 30) {
        await sendReminderIfNeeded({
          request,
          key: 'oneHour',
          title: 'تذكير بالحجز',
          body: 'متبقي حوالي ساعة على موعد الرحلة المجدولة',
        });
      }

      if (diffMinutes <= 30 && diffMinutes > 10) {
        await sendReminderIfNeeded({
          request,
          key: 'thirtyMinutes',
          title: 'تذكير بالحجز',
          body: 'متبقي حوالي نصف ساعة على موعد الرحلة المجدولة',
        });
      }

      if (diffMinutes <= 10 && diffMinutes >= 0) {
        await sendReminderIfNeeded({
          request,
          key: 'tenMinutes',
          title: 'تذكير بالحجز',
          body: 'متبقي حوالي 10 دقائق على موعد الرحلة المجدولة',
        });
      }
    }
  } catch (error) {
    console.error('Scheduled reminder worker error:', error.message);
  }
};

const startScheduledReminderWorker = () => {
  if (reminderInterval) {
    return;
  }

  checkScheduledRideReminders();

  reminderInterval = setInterval(() => {
    checkScheduledRideReminders();
  }, 60 * 1000);

  console.log('Scheduled reminder worker is running');
};

module.exports = {
  startScheduledReminderWorker,
};