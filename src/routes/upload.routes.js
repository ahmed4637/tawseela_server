const express = require('express');
const { param } = require('express-validator');

const { uploadSingleImage } = require('../controllers/upload.controller');
const { uploadImage, allowedFolders } = require('../middlewares/upload.middleware');

const validateRequest = require('../middlewares/validateRequest');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect);

router.post(
  '/:folder',
  [
    param('folder')
      .isIn(allowedFolders)
      .withMessage('نوع رفع الصور غير صحيح'),
  ],
  validateRequest,
  uploadImage.single('image'),
  uploadSingleImage
);

module.exports = router;