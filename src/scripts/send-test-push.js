require('dotenv').config();
const mongoose = require('mongoose');
const { createNotification } = require('../services/notification.service');

const accountId = process.argv[2];
const title = process.argv[3] || 'اختبار توصيلة';
const body = process.argv[4] || 'لو وصلتك الرسالة يبقى إشعارات توصيلة شغالة';

const main = async () => {
  if (!accountId) {
    console.error('Usage: node src/scripts/send-test-push.js <accountId> [title] [body]');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI || process.env.DB_URI);

  const notification = await createNotification({
    accountId,
    title,
    body,
    type: 'admin',
    data: {
      source: 'manual_test',
      sentAt: new Date().toISOString(),
    },
    sendPush: true,
  });

  console.log(JSON.stringify({
    notificationId: notification._id,
    pushStatus: notification.pushStatus,
    pushResult: notification.pushResult,
  }, null, 2));

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
