const { validationResult } = require('express-validator');
const { sendError } = require('../utils/apiResponse');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return next();
  }

  const formattedErrors = errors.array().map((error) => ({
    field: error.path,
    message: error.msg,
  }));

  return sendError({
    res,
    statusCode: 400,
    message: formattedErrors[0]?.message || 'بيانات غير صحيحة',
    errors: formattedErrors,
  });
};

module.exports = validateRequest;