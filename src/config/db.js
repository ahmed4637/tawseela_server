const mongoose = require('mongoose');

const getMongoUri = () => {
  return process.env.MONGO_URI || process.env.DB_URI || '';
};

const connectDB = async () => {
  const mongoUri = getMongoUri();

  if (!mongoUri) {
    throw new Error('MONGO_URI أو DB_URI غير موجود داخل ملف .env');
  }

  const conn = await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
  });

  console.log(`MongoDB Connected: ${conn.connection.host}`);

  return conn;
};

module.exports = connectDB;
