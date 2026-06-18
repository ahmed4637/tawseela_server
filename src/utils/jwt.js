const jwt = require('jsonwebtoken');

const generateToken = (payload) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN || '30d';

  if (!secret) {
    throw new Error('JWT_SECRET غير موجود داخل ملف .env');
  }

  return jwt.sign(payload, secret, { expiresIn });
};

module.exports = {
  generateToken,
};