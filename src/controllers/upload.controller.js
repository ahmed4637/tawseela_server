const { sendSuccess } = require('../utils/apiResponse');

const uploadSingleImage = (req, res) => {
  if (!req.file) {
    const error = new Error('الصورة مطلوبة');
    error.statusCode = 400;
    throw error;
  }

  const folder = req.params.folder || 'general';

  const fileUrl = `/uploads/${folder}/${req.file.filename}`;
  const fullUrl = `${req.protocol}://${req.get('host')}${fileUrl}`;

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