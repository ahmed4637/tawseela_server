const mongoose = require('mongoose');

const Address = require('../models/address.model');
const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');

const SPECIAL_ADDRESS_TYPES = ['home', 'work', 'last_destination'];

const normalizeName = (value) => {
  return value?.toString().trim().toLowerCase() || '';
};

const escapeRegex = (value) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const ensureCanAccessAccountAddresses = (req, accountId) => {
  if (!isValidObjectId(accountId)) {
    const error = new Error('رقم الحساب غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  if (!req.roles?.includes('admin') && req.accountId !== accountId) {
    const error = new Error('غير مسموح لك بعرض هذه العناوين');
    error.statusCode = 403;
    throw error;
  }
};

const ensureNoDuplicateName = async ({
  accountId,
  name,
  exceptAddressId = null,
}) => {
  const cleanName = normalizeName(name);

  const duplicateQuery = {
    accountId,
    isActive: true,
    name: { $regex: `^${escapeRegex(cleanName)}$`, $options: 'i' },
  };

  if (exceptAddressId) {
    duplicateQuery._id = { $ne: exceptAddressId };
  }

  const existing = await Address.findOne(duplicateQuery);

  if (existing) {
    const error = new Error(`يوجد عنوان محفوظ بالفعل باسم ${name}`);
    error.statusCode = 400;
    throw error;
  }
};

const ensureNoDuplicateSpecialType = async ({
  accountId,
  type,
  exceptAddressId = null,
}) => {
  if (!SPECIAL_ADDRESS_TYPES.includes(type)) {
    return;
  }

  const duplicateQuery = {
    accountId,
    type,
    isActive: true,
  };

  if (exceptAddressId) {
    duplicateQuery._id = { $ne: exceptAddressId };
  }

  const existing = await Address.findOne(duplicateQuery);

  if (existing) {
    const error = new Error('يوجد عنوان محفوظ بالفعل من نفس النوع');
    error.statusCode = 400;
    throw error;
  }
};

const getAllAddresses = asyncHandler(async (req, res) => {
  const { accountId } = req.params;

  ensureCanAccessAccountAddresses(req, accountId);

  const docs = await Address.find({
    accountId,
    isActive: true,
  }).sort({
    order: 1,
    createdAt: -1,
  });

  return sendSuccess({
    res,
    message: 'تم جلب العناوين بنجاح',
    docs,
  });
});

const getAddressById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم العنوان غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Address.findOne({
    _id: id,
    isActive: true,
  });

  if (!doc) {
    const error = new Error('العنوان غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (!req.roles?.includes('admin') && doc.accountId.toString() !== req.accountId) {
    const error = new Error('غير مسموح لك بعرض هذا العنوان');
    error.statusCode = 403;
    throw error;
  }

  return sendSuccess({
    res,
    message: 'تم جلب العنوان بنجاح',
    doc,
  });
});

const createAddress = asyncHandler(async (req, res) => {
  const {
    name,
    type = 'custom',
    address,
    notes,
    lng,
    lat,
    order,
  } = req.body;

  await ensureNoDuplicateName({
    accountId: req.accountId,
    name,
  });

  await ensureNoDuplicateSpecialType({
    accountId: req.accountId,
    type,
  });

  const doc = await Address.create({
    accountId: req.accountId,
    name,
    type,
    address,
    notes: notes || '',
    lng,
    lat,
    order: order || 0,
    isActive: true,
  });

  return sendSuccess({
    res,
    statusCode: 201,
    message: 'تم حفظ العنوان بنجاح',
    doc,
  });
});

const updateAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    name,
    type,
    address,
    notes,
    lng,
    lat,
    order,
    isActive,
  } = req.body;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم العنوان غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Address.findById(id);

  if (!doc || !doc.isActive) {
    const error = new Error('العنوان غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (!req.roles?.includes('admin') && doc.accountId.toString() !== req.accountId) {
    const error = new Error('غير مسموح لك بتعديل هذا العنوان');
    error.statusCode = 403;
    throw error;
  }

  if (name && normalizeName(name) !== normalizeName(doc.name)) {
    await ensureNoDuplicateName({
      accountId: doc.accountId,
      name,
      exceptAddressId: id,
    });
  }

  if (type && type !== doc.type) {
    await ensureNoDuplicateSpecialType({
      accountId: doc.accountId,
      type,
      exceptAddressId: id,
    });
  }

  doc.name = name ?? doc.name;
  doc.type = type ?? doc.type;
  doc.address = address ?? doc.address;
  doc.notes = notes ?? doc.notes;
  doc.lng = lng ?? doc.lng;
  doc.lat = lat ?? doc.lat;
  doc.order = order ?? doc.order;

  if (typeof isActive === 'boolean') {
    doc.isActive = isActive;
  }

  await doc.save();

  return sendSuccess({
    res,
    message: 'تم تعديل العنوان بنجاح',
    doc,
  });
});

const deleteAddress = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!isValidObjectId(id)) {
    const error = new Error('رقم العنوان غير صحيح');
    error.statusCode = 400;
    throw error;
  }

  const doc = await Address.findById(id);

  if (!doc || !doc.isActive) {
    const error = new Error('العنوان غير موجود');
    error.statusCode = 404;
    throw error;
  }

  if (!req.roles?.includes('admin') && doc.accountId.toString() !== req.accountId) {
    const error = new Error('غير مسموح لك بحذف هذا العنوان');
    error.statusCode = 403;
    throw error;
  }

  doc.isActive = false;
  await doc.save();

  return sendSuccess({
    res,
    message: 'تم حذف العنوان بنجاح',
  });
});

module.exports = {
  getAllAddresses,
  getAddressById,
  createAddress,
  updateAddress,
  deleteAddress,
};

// 