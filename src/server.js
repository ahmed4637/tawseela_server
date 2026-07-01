require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');

const app = require('./app');
const connectDB = require('./config/db');
const { initSocketServer } = require('./sockets/socket.server');
const {
  startScheduledReminderWorker,
  stopScheduledReminderWorker,
} = require('./workers/scheduledReminder.worker');
const { runStartupReadinessChecks } = require('./services/startup.service');

const PORT = process.env.PORT || 4000;

let httpServer = null;

const shouldStartWorkers = () => {
  return process.env.DISABLE_WORKERS !== 'true';
};

const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Closing Tawseela API...`);

  try {
    stopScheduledReminderWorker();

    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close(resolve);
      });
    }

    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close(false);
    }

    console.log('Tawseela API closed safely');
    process.exit(0);
  } catch (error) {
    console.error('Graceful shutdown error:', error);
    process.exit(1);
  }
};

const startServer = async () => {
  try {
    await connectDB();

    const readiness = await runStartupReadinessChecks();
    console.log('Startup readiness:', {
      db: readiness.database,
      defaults: readiness.defaults,
    });

    httpServer = http.createServer(app);

    initSocketServer(httpServer);

    if (shouldStartWorkers()) {
      await startScheduledReminderWorker();
    } else {
      console.log('Scheduled request worker is disabled by DISABLE_WORKERS=true');
    }

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Tawseela API is running on port ${PORT}`);
      console.log('Socket.io is running');
    });
  } catch (error) {
    console.error('Tawseela API startup failed:', error.message);
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

startServer();
