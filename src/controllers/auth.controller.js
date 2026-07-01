const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const Account = require('../models/account.model');
const DriverProfile = require('../models/driverProfile.model');
const DriverVehicle = require('../models/driverVehicle.model');

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const { generateToken } = require('../utils/jwt');
const { getDriverCommissionDebtLimit } = require('../services/appSettings.service');
const { getOrCreateLoyaltyAccount } = require('../services/loyalty.service');
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

const buildAccountAuthResponse = async (account) => {
  const safeAccount = account.toSafeObject();

  let driverProfile = null;
  let driverVehicles = [];
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

  const token = generateToken({
    accountId: account._id.toString(),
    role: account.defaultRole,
    roles: account.roles,
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
      roles: safeAccount.roles,
      defaultRole: safeAccount.defaultRole,
      isActive: safeAccount.isActive,
      walletBalance: safeAccount.walletBalance,
    },
    loyaltyAccount,
    driverProfile,
    driverVehicles,
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
      driverProfile,
      driverVehicle,
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
  await vehicle.save();

  const authData = await buildAccountAuthResponse(req.account);

  return sendSuccess({
    res,
    message: 'تم تحديث بيانات المركبة بنجاح',
    doc: {
      ...authData,
      driverVehicle: vehicle,
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
  becomeDriver,
  addDriverVehicle,
  updateDriverVehicle,
  switchRole,
  getMe,
  updateMe,
};