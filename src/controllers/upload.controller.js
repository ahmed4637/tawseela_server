const { sendSuccess } = require('../utils/apiResponse');


const getFirstHeaderValue = (value) => {
  if (!value) return '';

  if (Array.isArray(value)) {
    return value[0]?.toString().split(',')[0].trim() || '';
  }

  return value.toString().split(',')[0].trim();
};

const getPublicBaseUrl = (req) => {
  if (process.env.PUBLIC_BASE_URL) {
    return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  }

  const protocol =
    getFirstHeaderValue(req.headers['x-forwarded-proto']) ||
    req.protocol ||
    'https';

  const host =
    getFirstHeaderValue(req.headers['x-forwarded-host']) ||
    req.get('host') ||
    '';

  return `${protocol}://${host}`;
};


const uploadSingleImage = (req, res) => {
  if (!req.file) {
    const error = new Error('الصورة مطلوبة');
    error.statusCode = 400;
    throw error;
  }

  const folder = req.params.folder || 'general';

  const fileUrl = `/uploads/${folder}/${req.file.filename}`;
  const fullUrl = `${getPublicBaseUrl(req)}${fileUrl}`;

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم رفع الصورة بنجاح',
    doc: {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      folder,
      path: fileUrl,
      url: fullUrl,
    },
  });
};

module.exports = {
  uploadSingleImage,
};