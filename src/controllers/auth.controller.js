const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');
const DeviceToken = require('../models/deviceToken.model');
const PasswordResetAudit = require('../models/passwordResetAudit.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { generateToken } = require('../utils/jwt');
const { buildPublicUrl } = require('../utils/publicUrl');
const { getFirebaseAuth } = require('../services/firebaseAuth.service');
const { getDriverCommissionDebtLimit } = require('../services/appSettings.service');
const { getOrCreateLoyaltyAccount } = require('../services/loyalty.service');
const { getEffectiveAdminAccess } = require('../services/adminAccess.service');
const { assertNoActiveRestriction } = require('../services/penalty.service');
const {
  buildDriverReviewStatus,
  markDriverProfileResubmitted,
  markDriverVehicleResubmitted,
  createReviewLog,
} = require('../services/driverReview.service');
const normalizeEmail = (email) => {
  return email ? email.trim().toLowerCase() : '';
};

const normalizePhone = (phone) => {
  return phone ? phone.trim() : '';
};

const uploadFieldFolders = {
  nationalIdImage: 'national-ids',
  profileImage: 'profiles',
  vehicleImage: 'vehicles',
  licenseImage: 'licenses',
};

const normalizeUploadedImagePath = ({ value, fieldName, required = false }) => {
  const fieldLabel = {
    nationalIdImage: 'صورة البطاقة',
    profileImage: 'الصورة الشخصية',
    vehicleImage: 'صورة المركبة',
    licenseImage: 'صورة الرخصة',
  }[fieldName] || 'الصورة';

  if (!value || !value.toString().trim()) {
    if (required) {
      const error = new Error(`${fieldLabel} مطلوبة`);
      error.statusCode = 400;
      throw error;
    }

    return '';
  }

  let cleanValue = value.toString().trim();

  if (cleanValue.startsWith('http://') || cleanValue.startsWith('https://')) {
    try {
      const parsedUrl = new URL(cleanValue);
      cleanValue = parsedUrl.pathname;
    } catch (error) {
      const err = new Error(`مسار ${fieldLabel} غير صحيح`);
      err.statusCode = 400;
      throw err;
    }
  }

  cleanValue = cleanValue.replace(/\\/g, '/');
  cleanValue = cleanValue.split('?')[0];

  if (cleanValue.startsWith('uploads/')) {
    cleanValue = `/${cleanValue}`;
  }

  if (cleanValue.startsWith('/api/uploads/')) {
    cleanValue = cleanValue.replace('/api/uploads/', '/uploads/');
  }

  if (!cleanValue.startsWith('/uploads/')) {
    const error = new Error(`مسار ${fieldLabel} يجب أن يبدأ بـ /uploads`);
    error.statusCode = 400;
    throw error;
  }

  const expectedFolder = uploadFieldFolders[fieldName];

  if (expectedFolder && !cleanValue.startsWith(`/uploads/${expectedFolder}/`)) {
    const error = new Error(`${fieldLabel} في فولدر غير صحيح`);
    error.statusCode = 400;
    throw error;
  }

  const relativePath = cleanValue.replace(/^\/+/, '');
  const diskPath = path.join(process.cwd(), relativePath);

  if (!fs.existsSync(diskPath)) {
    const error = new Error(`${fieldLabel} غير موجودة على السيرفر`);
    error.statusCode = 400;
    throw error;
  }

  return cleanValue;
};

const plateOptionalVehicleCodes = ['tuktuk', 'tricycle', 'motorcycle'];

const isPlateNumberRequired = (vehicleTypeCode) => {
  const code = vehicleTypeCode ? vehicleTypeCode.trim() : '';
  return !plateOptionalVehicleCodes.includes(code);
};

const validatePlateNumberByVehicle = ({ vehicleTypeCode, plateNumber }) => {
  if (isPlateNumberRequired(vehicleTypeCode) && !plateNumber?.trim()) {
    const error = new Error('رقم المركبة مطلوب لهذا النوع من المركبات');
    error.statusCode = 400;
    throw error;
  }
};


const toPlainObject = (doc) => {
  if (!doc) return doc;
  return typeof doc.toObject === 'function' ? doc.toObject() : doc;
};

const withProfileImageUrls = (accountObject) => {
  if (!accountObject) return accountObject;

  const raw = toPlainObject(accountObject);
  const profileImage = raw.profileImage || raw.image || raw.photo || raw.avatar || '';

  return {
    ...raw,
    profileImage: raw.profileImage || profileImage,
    profileImageUrl: buildPublicUrl(profileImage),
  };
};

const withDriverProfileImageUrls = (profileObject) => {
  if (!profileObject) return profileObject;

  const raw = toPlainObject(profileObject);

  return {
    ...raw,
    profileImageUrl: buildPublicUrl(raw.profileImage),
    nationalIdImageUrl: buildPublicUrl(raw.nationalIdImage),
    licenseImageUrl: buildPublicUrl(raw.licenseImage),
  };
};

const withDriverVehicleImageUrls = (vehicleObject) => {
  if (!vehicleObject) return vehicleObject;

  const raw = toPlainObject(vehicleObject);
  const vehicleImage = raw.vehicleImage || raw.vehiclePhoto || raw.carImage || raw.image || raw.photo || '';

  return {
    ...raw,
    vehicleImage: raw.vehicleImage || vehicleImage,
    vehicleImageUrl: buildPublicUrl(vehicleImage),
    licenseImageUrl: buildPublicUrl(raw.licenseImage),
  };
};

const buildAccountAuthResponse = async (account) => {
  const safeAccount = account.toSafeObject();

  let driverProfile = null;
  let driverVehicles = [];
  let adminAccess = null;

  const loyaltyAccount = await getOrCreateLoyaltyAccount({
    accountId: account._id,
    accountRole: account.defaultRole === 'driver' && account.roles.includes('driver') ? 'driver' : 'customer',
  });

  if (account.roles.includes('driver')) {
    driverProfile = await DriverProfile.findOne({
      accountId: account._id,
    });

    driverVehicles = await DriverVehicle.find({
      accountId: account._id,
      isActive: true,
    }).sort({
      isDefault: -1,
      createdAt: -1,
    });
  }

  if (account.roles.includes('admin')) {
    adminAccess = await getEffectiveAdminAccess(account);
  }

  const token = generateToken({
    accountId: account._id.toString(),
    role: account.defaultRole,
    roles: account.roles,
    tokenVersion: Number(account.tokenVersion || 0),
  });

  return {
    token,
    account: {
      id: safeAccount._id.toString(),
      _id: safeAccount._id,
      name: safeAccount.name,
      email: safeAccount.email,
      phone: safeAccount.phone,
      profileImage: safeAccount.profileImage || '',
      profileImageUrl: buildPublicUrl(safeAccount.profileImage),
      roles: safeAccount.roles,
      defaultRole: safeAccount.defaultRole,
      isActive: safeAccount.isActive,
      walletBalance: safeAccount.walletBalance,
      adminRoleKey: safeAccount.adminRoleKey || '',
      isSuperAdmin: safeAccount.isSuperAdmin === true,
    },
    adminAccess,
    loyaltyAccount,
    driverProfile: withDriverProfileImageUrls(driverProfile),
    driverVehicles: driverVehicles.map(withDriverVehicleImageUrls),
  };
};

const signup = asyncHandler(async (req, res) => {
  const { name, password } = req.body;

  const email = normalizeEmail(req.body.email);
  const phone = normalizePhone(req.body.phone);

  const duplicateFilters = [{ phone }];

  if (email) {
    duplicateFilters.push({ email });
  }

  const existingAccount = await Account.findOne({
    $or: duplicateFilters,
  });

  if (existingAccount) {
    if (existingAccount.phone === phone) {
      const error = new Error('رقم الهاتف مستخدم بالفعل');
      error.statusCode = 400;
      throw error;
    }

    if (email && existingAccount.email === email) {
      const error = new Error('البريد الإلكتروني مستخدم بالفعل');
      error.statusCode = 400;
      throw error;
    }

    const error = new Error('بيانات الحساب مستخدمة بالفعل');
    error.statusCode = 400;
    throw error;
  }

  const account = await Account.create({
    name: name.trim(),
    email,
    phone,
    password,
    roles: ['customer'],
    defaultRole: 'customer',
  });

  const authData = await buildAccountAuthResponse(account);

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إنشاء الحساب بنجاح',
    doc: authData,
  });
});
const login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  const account = await Account.findOne({ phone }).select('+password');

  if (!account) {
    const error = new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    error.statusCode = 401;
    throw error;
  }

  if (!account.isActive) {
    const error = new Error('هذا الحساب غير مفعل');
    error.statusCode = 403;
    throw error;
  }

  const isPasswordCorrect = await account.comparePassword(password);

  if (!isPasswordCorrect) {
    const error = new Error('رقم الهاتف أو كلمة المرور غير صحيحة');
    error.statusCode = 401;
    throw error;
  }

  account.lastLoginAt = new Date();
  await account.save();

  const authData = await buildAccountAuthResponse(account);

  return sendSuccess({
    res,
    message: 'تم تسجيل الدخول بنجاح',
    doc: authData,
  });
});

const normalizeFirebaseEgyptPhone = (value) => {
  const raw = value ? value.toString().trim().replace(/[\s-]/g, '') : '';

  if (/^\+20(10|11|12|15)\d{8}$/.test(raw)) {
    return `0${raw.substring(3)}`;
  }

  if (/^20(10|11|12|15)\d{8}$/.test(raw)) {
    return `0${raw.substring(2)}`;
  }

  if (/^(010|011|012|015)\d{8}$/.test(raw)) {
    return raw;
  }

  return '';
};

const resetPasswordWithFirebasePhone = asyncHandler(async (req, res) => {
  const { firebaseIdToken, newPassword } = req.body;

  let decodedToken;

  try {
    decodedToken = await getFirebaseAuth().verifyIdToken(
      firebaseIdToken.toString().trim(),
      true
    );
  } catch (error) {
    const verificationError = new Error(
      'جلسة التحقق غير صالحة أو انتهت، اطلب رمزًا جديدًا'
    );
    verificationError.statusCode = 401;
    throw verificationError;
  }

  const signInProvider = decodedToken.firebase?.sign_in_provider || '';
  const verifiedPhone = normalizeFirebaseEgyptPhone(
    decodedToken.phone_number
  );

  if (signInProvider !== 'phone' || !verifiedPhone) {
    const error = new Error('يجب التحقق من رقم الموبايل أولًا');
    error.statusCode = 401;
    throw error;
  }

  const authenticatedAt = Number(
    decodedToken.auth_time || decodedToken.iat || 0
  );
  const tokenIssuedAt = Number(decodedToken.iat || authenticatedAt || 0);
  const verificationAgeSeconds = Math.floor(Date.now() / 1000) - authenticatedAt;

  if (
    !authenticatedAt ||
    verificationAgeSeconds < -60 ||
    verificationAgeSeconds > 10 * 60
  ) {
    const error = new Error('انتهت مهلة رمز التحقق، اطلب رمزًا جديدًا');
    error.statusCode = 401;
    throw error;
  }

  const account = await Account.findOne({ phone: verifiedPhone });

  if (!account) {
    const error = new Error('لا يوجد حساب توصيلة مرتبط برقم الموبايل ده');
    error.statusCode = 404;
    throw error;
  }

  let auditRecord;

  try {
    auditRecord = await PasswordResetAudit.create({
      accountId: account._id,
      phone: verifiedPhone,
      firebaseUid: decodedToken.uid,
      authenticatedAt,
      tokenIssuedAt,
      usedAt: new Date(),
      ipAddress: req.ip || '',
      userAgent: req.get('user-agent') || '',
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateError = new Error(
        'تم استخدام جلسة التحقق دي بالفعل، اطلب رمزًا جديدًا'
      );
      duplicateError.statusCode = 409;
      throw duplicateError;
    }

    throw error;
  }

  try {
    account.password = newPassword.toString();
    account.passwordChangedAt = new Date();
    account.tokenVersion = Number(account.tokenVersion || 0) + 1;
    await account.save();
  } catch (error) {
    await PasswordResetAudit.deleteOne({ _id: auditRecord._id });
    throw error;
  }

  const cleanupResults = await Promise.allSettled([
    DeviceToken.updateMany(
      { accountId: account._id, isActive: true },
      {
        isActive: false,
        disabledReason: 'password_reset',
      }
    ),
    getFirebaseAuth().revokeRefreshTokens(decodedToken.uid),
  ]);

  cleanupResults.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Password reset cleanup error:', result.reason?.message || result.reason);
    }
  });

  return sendSuccess({
    res,
    message: 'تم تغيير كلمة السر بنجاح، سجل دخول بالكلمة الجديدة',
    doc: {
      success: true,
      phone: verifiedPhone,
    },
  });
});

const becomeDriver = asyncHandler(async (req, res) => {
  const {
    nationalIdImage,
    profileImage,
    vehicleTypeId,
    vehicleTypeCode,
    vehicleTypeName,
    model,
    plateNumber,
    color,
    vehicleImage,
    licenseImage,
    notes,
  } = req.body;

  validatePlateNumberByVehicle({
  vehicleTypeCode,
  plateNumber,
});

const cleanNationalIdImage = normalizeUploadedImagePath({
  value: nationalIdImage,
  fieldName: 'nationalIdImage',
  required: true,
});

const cleanProfileImage = normalizeUploadedImagePath({
  value: profileImage,
  fieldName: 'profileImage',
  required: false,
});

const cleanVehicleImage = normalizeUploadedImagePath({
  value: vehicleImage,
  fieldName: 'vehicleImage',
  required: true,
});

const cleanLicenseImage = normalizeUploadedImagePath({
  value: licenseImage,
  fieldName: 'licenseImage',
  required: false,
});

  const account = req.account;
 if (cleanProfileImage) {
  account.profileImage = cleanProfileImage;
}

  let driverProfile = await DriverProfile.findOne({
    accountId: account._id,
  });

  if (!driverProfile) {
    if (!nationalIdImage) {
      const error = new Error('صورة البطاقة مطلوبة');
      error.statusCode = 400;
      throw error;
    }

    driverProfile = await DriverProfile.create({
      accountId: account._id,
      nationalIdImage: cleanNationalIdImage,
      profileImage: cleanProfileImage,
      isApproved: false,
      reviewStatus: 'pending',
      commissionDebt: 0,
      commissionDebtLimit: await getDriverCommissionDebtLimit(),
    });

    await createReviewLog({
      entityType: 'driver_profile',
      driverProfileId: driverProfile._id,
      accountId: account._id,
      action: 'submitted',
      oldReviewStatus: '',
      newReviewStatus: 'pending',
      reason: 'إرسال طلب الانضمام كسائق للمراجعة',
      source: 'driver_app',
    });
  } else if (['rejected', 'needs_update'].includes(driverProfile.reviewStatus)) {
    driverProfile.nationalIdImage = cleanNationalIdImage || driverProfile.nationalIdImage;
    driverProfile.profileImage = cleanProfileImage || driverProfile.profileImage;
    driverProfile.isApproved = false;
    driverProfile.reviewStatus = 'pending';
    driverProfile.rejectionReason = '';
    driverProfile.approvedAt = null;
    driverProfile.reviewedAt = null;
    driverProfile.reviewedBy = null;
    driverProfile.isOnline = false;
    driverProfile.isAvailable = false;
    await driverProfile.save();

    await createReviewLog({
      entityType: 'driver_profile',
      driverProfileId: driverProfile._id,
      accountId: account._id,
      action: 'resubmitted',
      oldReviewStatus: 'rejected_or_needs_update',
      newReviewStatus: 'pending',
      reason: 'إعادة إرسال بيانات السائق للمراجعة',
      source: 'driver_app',
    });
  }

  const driverVehicle = await DriverVehicle.create({
    accountId: account._id,
    vehicleTypeId: vehicleTypeId || null,
    vehicleTypeCode,
    vehicleTypeName,
    model: model || '',
    plateNumber: plateNumber || '',
    color: color || '',
    vehicleImage: cleanVehicleImage,
    licenseImage: cleanLicenseImage,
    notes: notes || '',
    isApproved: false,
    reviewStatus: 'pending',
    isDefault: true,
  });

  await createReviewLog({
    entityType: 'driver_vehicle',
    driverProfileId: driverProfile._id,
    driverVehicleId: driverVehicle._id,
    accountId: account._id,
    action: 'submitted',
    oldReviewStatus: '',
    newReviewStatus: 'pending',
    reason: 'إرسال مركبة للمراجعة',
    source: 'driver_app',
  });

  if (!account.roles.includes('driver')) {
    account.roles.push('driver');
  }

  account.defaultRole = 'driver';
  await account.save();

  await getOrCreateLoyaltyAccount({
    accountId: account._id,
    accountRole: 'driver',
  });

  const authData = await buildAccountAuthResponse(account);

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إرسال طلب الانضمام كسائق للمراجعة',
    doc: {
      ...authData,
      driverProfile: withDriverProfileImageUrls(driverProfile),
      driverVehicle: withDriverVehicleImageUrls(driverVehicle),
    },
  });
});

const addDriverVehicle = asyncHandler(async (req, res) => {
  if (!req.account.roles.includes('driver')) {
    const error = new Error('يجب تفعيل حساب السائق أولًا');
    error.statusCode = 403;
    throw error;
  }

  const {
    vehicleTypeId,
    vehicleTypeCode,
    vehicleTypeName,
    model,
    plateNumber,
    color,
    vehicleImage,
    licenseImage,
    notes,
    isDefault,
  } = req.body;

  validatePlateNumberByVehicle({
  vehicleTypeCode,
  plateNumber,
});
const cleanVehicleImage = normalizeUploadedImagePath({
  value: vehicleImage,
  fieldName: 'vehicleImage',
  required: true,
});

const cleanLicenseImage = normalizeUploadedImagePath({
  value: licenseImage,
  fieldName: 'licenseImage',
  required: false,
});

  const vehicle = await DriverVehicle.create({
    accountId: req.account._id,
    vehicleTypeId: vehicleTypeId || null,
    vehicleTypeCode,
    vehicleTypeName,
    model: model || '',
    plateNumber: plateNumber || '',
    color: color || '',
    vehicleImage:cleanVehicleImage,
    licenseImage:cleanLicenseImage,
    notes: notes || '',
    isApproved: false,
    reviewStatus: 'pending',
    isDefault: isDefault === true,
  });

  const driverProfile = await DriverProfile.findOne({ accountId: req.account._id });

  await createReviewLog({
    entityType: 'driver_vehicle',
    driverProfileId: driverProfile?._id || null,
    driverVehicleId: vehicle._id,
    accountId: req.account._id,
    action: 'submitted',
    oldReviewStatus: '',
    newReviewStatus: 'pending',
    reason: 'إضافة مركبة جديدة للمراجعة',
    source: 'driver_app',
  });

  if (isDefault === true) {
    await DriverVehicle.updateMany(
      {
        accountId: req.account._id,
        _id: { $ne: vehicle._id },
      },
      {
        isDefault: false,
      }
    );
  }

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم إضافة المركبة وإرسالها للمراجعة',
    doc: vehicle,
  });
});

const updateDriverVehicle = asyncHandler(async (req, res) => {
  if (!req.account.roles.includes('driver')) {
    const error = new Error('يجب تفعيل حساب السائق أولًا');
    error.statusCode = 403;
    throw error;
  }

  const { vehicleId } = req.params;

  const {
    vehicleTypeId,
    vehicleTypeCode,
    vehicleTypeName,
    model,
    plateNumber,
    color,
    vehicleImage,
    licenseImage,
    notes,
    isDefault,
  } = req.body;

  const vehicle = await DriverVehicle.findOne({
    _id: vehicleId,
    accountId: req.account._id,
    isActive: true,
  });

  if (!vehicle) {
    const error = new Error('المركبة غير موجودة');
    error.statusCode = 404;
    throw error;
  }

  if (vehicleTypeId !== undefined) {
    vehicle.vehicleTypeId = vehicleTypeId || null;
  }

  if (vehicleTypeCode !== undefined && vehicleTypeCode.trim()) {
    vehicle.vehicleTypeCode = vehicleTypeCode.trim();
  }

  if (vehicleTypeName !== undefined && vehicleTypeName.trim()) {
    vehicle.vehicleTypeName = vehicleTypeName.trim();
  }

  if (model !== undefined) {
    vehicle.model = model || '';
  }

  if (plateNumber !== undefined) {
    vehicle.plateNumber = plateNumber || '';
  }

  if (color !== undefined) {
    vehicle.color = color || '';
  }
const cleanVehicleImage =
  vehicleImage !== undefined
    ? normalizeUploadedImagePath({
        value: vehicleImage,
        fieldName: 'vehicleImage',
        required: false,
      })
    : undefined;

const cleanLicenseImage =
  licenseImage !== undefined
    ? normalizeUploadedImagePath({
        value: licenseImage,
        fieldName: 'licenseImage',
        required: false,
      })
    : undefined;

 if (cleanVehicleImage) {
  vehicle.vehicleImage = cleanVehicleImage;
}

if (cleanLicenseImage !== undefined) {
  vehicle.licenseImage = cleanLicenseImage;
}

  if (notes !== undefined) {
    vehicle.notes = notes || '';
  }

  if (isDefault !== undefined) {
    vehicle.isDefault = isDefault === true || isDefault === 'true';

    if (vehicle.isDefault) {
      await DriverVehicle.updateMany(
        {
          accountId: req.account._id,
          _id: { $ne: vehicle._id },
        },
        {
          isDefault: false,
        }
      );
    }
  }

validatePlateNumberByVehicle({
  vehicleTypeCode: vehicle.vehicleTypeCode,
  plateNumber: vehicle.plateNumber,
});

  if (['rejected', 'needs_update'].includes(vehicle.reviewStatus)) {
    await markDriverVehicleResubmitted({
      vehicle,
      reason: 'تعديل بيانات المركبة وإعادة إرسالها للمراجعة',
    });
  } else {
    await vehicle.save();
  }

  const authData = await buildAccountAuthResponse(req.account);

  return sendSuccess({
    res,
    message: 'تم تحديث بيانات المركبة بنجاح',
    doc: {
      ...authData,
      driverVehicle: withDriverVehicleImageUrls(vehicle),
    },
  });
});

const switchRole = asyncHandler(async (req, res) => {
  const { role } = req.body;

  if (!['customer', 'driver', 'admin'].includes(role)) {
    const error = new Error('نوع الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  if (!req.account.roles.includes(role)) {
    const error = new Error('هذا الدور غير متاح لهذا الحساب');
    error.statusCode = 403;
    throw error;
  }

  req.account.defaultRole = role;
  await req.account.save();

  const authData = await buildAccountAuthResponse(req.account);

  return sendSuccess({
    res,
    message: 'تم تغيير وضع الحساب بنجاح',
    doc: authData,
  });
});

const updateMe = asyncHandler(async (req, res) => {
  const accountId = req.account?._id;

  if (!accountId) {
    const error = new Error('غير مصرح، سجل دخول أولًا');
    error.statusCode = 401;
    throw error;
  }

  const { name, email, phone, password, profileImage } = req.body;

  const updateData = {};

  if (name && name.trim()) {
    updateData.name = name.trim();
  }

 if (email !== undefined) {
  const cleanEmail = normalizeEmail(email);

  if (cleanEmail) {
    const existingEmail = await Account.findOne({
      email: cleanEmail,
      _id: { $ne: accountId },
    });

    if (existingEmail) {
      const error = new Error('البريد الإلكتروني مستخدم بالفعل');
      error.statusCode = 400;
      throw error;
    }
  }

  updateData.email = cleanEmail;
}

 if (phone && phone.trim()) {
  const cleanPhone = normalizePhone(phone);

  const existingPhone = await Account.findOne({
    phone: cleanPhone,
    _id: { $ne: accountId },
  });

  if (existingPhone) {
    const error = new Error('رقم الهاتف مستخدم بالفعل');
    error.statusCode = 400;
    throw error;
  }

  updateData.phone = cleanPhone;
}

  if (password && password.trim()) {
    updateData.password = await bcrypt.hash(password.trim(), 12);
  }

  if (profileImage !== undefined && profileImage.toString().trim()) {
  updateData.profileImage = normalizeUploadedImagePath({
    value: profileImage,
    fieldName: 'profileImage',
    required: false,
  });
}

  const account = await Account.findByIdAndUpdate(accountId, updateData, {
    new: true,
    runValidators: true,
  });

  if (!account) {
    const error = new Error('الحساب غير موجود');
    error.statusCode = 404;
    throw error;
  }

  const authData = await buildAccountAuthResponse(account);

  return sendSuccess({
    res,
    message: 'تم تحديث البروفايل بنجاح',
    doc: authData,
  });
});


const readCoordinate = (value, fieldName) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    const error = new Error(`${fieldName} غير صحيح`);
    error.statusCode = 400;
    throw error;
  }

  return number;
};

const setDriverOnline = asyncHandler(async (req, res) => {
  if (!req.account.roles.includes('driver')) {
    const error = new Error('هذا الإجراء متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const lat = readCoordinate(req.body.lat ?? req.body.latitude, 'خط العرض');
  const lng = readCoordinate(req.body.lng ?? req.body.longitude, 'خط الطول');
  const hasLocation = lat !== null && lng !== null;

  if ((lat === null) !== (lng === null)) {
    const error = new Error('بيانات الموقع غير مكتملة');
    error.statusCode = 400;
    throw error;
  }

  const [driverProfile, , approvedVehicleCount] = await Promise.all([
    DriverProfile.findOne({ accountId: req.account._id }),
    assertNoActiveRestriction({
      accountId: req.account._id,
      restrictionTypes: ['app_usage', 'driver_online', 'receiving_requests'],
    }),
    DriverVehicle.countDocuments({
      accountId: req.account._id,
      isActive: true,
      isApproved: true,
      reviewStatus: 'approved',
    }),
  ]);

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (!driverProfile.isApproved || driverProfile.reviewStatus !== 'approved') {
    const error = new Error('حساب السائق لم تتم الموافقة عليه بعد');
    error.statusCode = 403;
    throw error;
  }

  if (approvedVehicleCount === 0) {
    const error = new Error('لا يمكن فتح Online قبل اعتماد مركبة واحدة على الأقل');
    error.statusCode = 403;
    throw error;
  }

  driverProfile.refreshDebtBlockStatus();

  if (
    driverProfile.isBlockedForDebt ||
    Number(driverProfile.commissionDebt || 0) >= Number(driverProfile.commissionDebtLimit || 0)
  ) {
    driverProfile.isBlockedForDebt = true;
    driverProfile.blockedReason = driverProfile.blockedReason || 'تم إيقاف استقبال الرحلات بسبب مستحقات التطبيق';
    driverProfile.isOnline = false;
    driverProfile.isAvailable = false;
    await driverProfile.save();

    const error = new Error(driverProfile.blockedReason);
    error.statusCode = 403;
    throw error;
  }

  driverProfile.isOnline = true;
  driverProfile.isAvailable = !driverProfile.activeServiceRequestId;
  driverProfile.lastOnlineAt = new Date();

  if (hasLocation) {
    driverProfile.currentLat = lat;
    driverProfile.currentLng = lng;
    driverProfile.currentLocation = {
      type: 'Point',
      coordinates: [lng, lat],
    };
    driverProfile.currentLocationUpdatedAt = new Date();
  }

  await driverProfile.save();

  return sendSuccess({
    res,
    message: 'السائق أصبح Online',
    doc: {
      success: true,
      isOnline: true,
      isAvailable: driverProfile.isAvailable,
      driverProfile,
    },
  });
});

const setDriverOffline = asyncHandler(async (req, res) => {
  if (!req.account.roles.includes('driver')) {
    const error = new Error('هذا الإجراء متاح للسائق فقط');
    error.statusCode = 403;
    throw error;
  }

  const driverProfile = await DriverProfile.findOne({ accountId: req.account._id });

  if (!driverProfile) {
    const error = new Error('ملف السائق غير موجود');
    error.statusCode = 404;
    throw error;
  }

  driverProfile.isOnline = false;
  driverProfile.isAvailable = false;
  await driverProfile.save();

  return sendSuccess({
    res,
    message: 'السائق أصبح Offline',
    doc: {
      success: true,
      isOnline: false,
      isAvailable: false,
      driverProfile,
    },
  });
});


const getDriverReviewStatus = asyncHandler(async (req, res) => {
  const status = await buildDriverReviewStatus(req.account._id);

  return sendSuccess({
    res,
    message: 'تم جلب حالة مراجعة السائق بنجاح',
    doc: status,
  });
});

const resubmitDriverReview = asyncHandler(async (req, res) => {
  await markDriverProfileResubmitted({
    accountId: req.account._id,
    reason: req.body.reason || 'إعادة إرسال بيانات السائق للمراجعة',
  });

  const status = await buildDriverReviewStatus(req.account._id);

  return sendSuccess({
    res,
    message: 'تم إرسال بيانات السائق للمراجعة مرة أخرى',
    doc: status,
  });
});

const getMe = asyncHandler(async (req, res) => {
  const authData = await buildAccountAuthResponse(req.account);

  return sendSuccess({
    res,
    message: 'تم جلب بيانات الحساب بنجاح',
    doc: authData,
  });
});

module.exports = {
  signup,
  login,
  resetPasswordWithFirebasePhone,
  becomeDriver,
  addDriverVehicle,
  updateDriverVehicle,
  switchRole,
  getDriverReviewStatus,
  resubmitDriverReview,
  setDriverOnline,
  setDriverOffline,
  getMe,
  updateMe,
};