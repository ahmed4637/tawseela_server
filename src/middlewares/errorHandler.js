const { sendError } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  let statusCode = err.statusCode || 500;
  let message = err.message || 'حدث خطأ غير متوقع';

  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors)
      .map((item) => item.message)
      .join(' - ');
  }

  if (err.code === 11000) {
    statusCode = 400;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `${field} مستخدم بالفعل`;
  }

  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'رقم غير صحيح';
  }

  return sendError({
    res,
    statusCode,
    message,
  });
};

module.exports = errorHandler;