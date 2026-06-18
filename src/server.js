require('dotenv').config();

const http = require('http');

const app = require('./app');
const connectDB = require('./config/db');
const { initSocketServer } = require('./sockets/socket.server');
const { startScheduledReminderWorker } = require('./workers/scheduledReminder.worker');

const PORT = process.env.PORT || 4000;

const startServer = async () => {
  await connectDB();

  const httpServer = http.createServer(app);

  initSocketServer(httpServer);

  startScheduledReminderWorker();

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Tawseela API is running on port ${PORT}`);
    console.log('Socket.io is running');
  });
};

startServer();