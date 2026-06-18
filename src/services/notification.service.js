const Notification = require('../models/notification.model');
const { emitToAccount } = require('../sockets/socket.server');

const createNotification = async ({
  accountId,
  title,
  body,
  type = 'general',
  data = {},
}) => {
  const notification = await Notification.create({
    accountId,
    title,
    body,
    type,
    data,
  });

  try {
    emitToAccount(accountId.toString(), 'notification:new', {
      notification,
    });
  } catch (error) {
    console.error('Notification socket error:', error.message);
  }

  return notification;
};

const createManyNotifications = async (items = []) => {
  const created = [];

  for (const item of items) {
    const notification = await createNotification(item);
    created.push(notification);
  }

  return created;
};

module.exports = {
  createNotification,
  createManyNotifications,
};