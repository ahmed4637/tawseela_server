const fs = require('fs');
const path = require('path');
const multer = require('multer');

const allowedFolders = [
  'national-ids',
  'profiles',
  'vehicles',
  'licenses',
  'general',
];

const allowedMimeTypes = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const ensureFolderExists = (folderPath) => {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = req.params.folder || 'general';

    if (!allowedFolders.includes(folder)) {
      return cb(new Error('نوع رفع الصور غير صحيح'));
    }

    const uploadPath = path.join(process.cwd(), 'uploads', folder);

    ensureFolderExists(uploadPath);

    return cb(null, uploadPath);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

    return cb(null, safeName);
  },
});

const fileFilter = (req, file, cb) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return cb(new Error('نوع الملف غير مسموح، برجاء رفع صورة فقط'));
  }

  return cb(null, true);
};

const uploadImage = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

module.exports = {
  uploadImage,
  allowedFolders,
};