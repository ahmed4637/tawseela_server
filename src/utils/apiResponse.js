const sendSuccess = ({
  res,
  statusCode = 200,
  message = 'تم بنجاح',
  doc = undefined,
  docs = undefined,
  extra = {},
}) => {
  const response = {
    success: true,
    message,
    ...extra,
  };

  if (doc !== undefined) {
    response.doc = doc;
  }

  if (docs !== undefined) {
    response.docs = docs;
  }

  return res.status(statusCode).json(response);
};

const sendError = ({
  res,
  statusCode = 500,
  message = 'حدث خطأ غير متوقع',
  errors = undefined,
}) => {
  const response = {
    success: false,
    message,
  };

  if (errors !== undefined) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

module.exports = {
  sendSuccess,
  sendError,
};